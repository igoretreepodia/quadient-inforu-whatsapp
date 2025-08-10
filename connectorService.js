const axios = require('axios');

class SendingThrottler {
  constructor() {
    this._queued = Promise.resolve();
  }
  throttle(segments, perSecond) {
    const delayMs = (segments / perSecond) * 1000;
    this._queued = this._queued.then(() => new Promise(r => setTimeout(r, delayMs)));
    return this._queued;
  }
}

async function sendMessages(config, messages, callbackUrl) {
  const throttler = new SendingThrottler();
  const results = [];
  for (const msg of messages) {
    if (config.segmentsPerSecond) {
      const segs = getSegments(msg.message);
      await throttler.throttle(segs, config.segmentsPerSecond);
    }
    results.push(await sendSingle(config, msg, callbackUrl));
  }
  return results;
}

/**
 * Inspects msg.message. If it's JSON with a "template" field, delegate to sendTemplateMessage.
 * Otherwise, return error since Inforu requires template messages for first contact.
 */
async function sendSingle(config, msg, callbackUrl) {
  let parsed;
  try {
    parsed = JSON.parse(msg.message);
  } catch (_) {
    // Not JSON → error for Inforu (must be template for first contact)
    return {
      batchId: msg.batchId,
      messageId: msg.messageId,
      successfullySent: false,
      isRetryable: false,
      errorMessage: 'Inforu requires template messages for initial contact. Message must be JSON with template field.'
    };
  }

  if (parsed && parsed.template) {
    return sendTemplateMessage(config, msg, callbackUrl);
  }

  return {
    batchId: msg.batchId,
    messageId: msg.messageId,
    successfullySent: false,
    isRetryable: false,
    errorMessage: 'Message must contain template field for Inforu WhatsApp'
  };
}

/**
 * Sends a template-based WhatsApp message via Inforu API.
 * Expects msg.message to be a JSON string containing a "template" object with templateId.
 */
async function sendTemplateMessage(config, msg, callbackUrl) {
  console.log(`Sending Inforu template message: ${msg.message}`);
  const url = 'https://capi.inforu.co.il/api/v2/WhatsApp/SendWhatsApp';
  const auth = Buffer.from(`${config.username}:${config.token}`).toString('base64');

  let parsed;
  try {
    parsed = JSON.parse(msg.message);
  } catch (_) {
    return {
      batchId: msg.batchId,
      messageId: msg.messageId,
      successfullySent: false,
      isRetryable: false,
      errorMessage: 'Invalid JSON for template payload'
    };
  }

  const templatePayload = parsed.template;
  if (!templatePayload || !templatePayload.templateId) {
    return {
      batchId: msg.batchId,
      messageId: msg.messageId,
      successfullySent: false,
      isRetryable: false,
      errorMessage: 'Template must contain templateId'
    };
  }

  // Build TemplateParameters array from components
  const templateParameters = [];
  if (Array.isArray(templatePayload.components)) {
    for (const comp of templatePayload.components) {
      if (comp.type === 'body' && Array.isArray(comp.parameters)) {
        comp.parameters.forEach((paramObj, idx) => {
          if (paramObj.type === 'text') {
            templateParameters.push({
              Name: `[#${idx + 1}#]`, // Inforu uses [#1#], [#2#], etc.
              Type: paramObj.valueType || 'Text', // Text, Contact, or Custom
              Value: paramObj.text || ''
            });
          }
        });
      }
    }
  }

  // Build recipient object
  const recipient = {
    Phone: msg.recipient.replace(/^whatsapp:/, ''), // Remove whatsapp: prefix if present
    FirstName: templatePayload.recipientData?.firstName || '',
    LastName: templatePayload.recipientData?.lastName || ''
  };

  // Add any custom fields from recipientData
  if (templatePayload.recipientData) {
    Object.keys(templatePayload.recipientData).forEach(key => {
      if (!['firstName', 'lastName'].includes(key)) {
        recipient[key] = templatePayload.recipientData[key];
      }
    });
  }

  const requestBody = {
    Data: {
      TemplateId: templatePayload.templateId,
      TemplateParameters: templateParameters,
      Recipients: [recipient],
      DeliveryNotificationUrl: `${callbackUrl}/${msg.batchId}/${msg.messageId}`,
      CustomerMessageId: `${msg.batchId}_${msg.messageId}`
    }
  };

  try {
    const resp = await axios.post(url, requestBody, {
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json'
      }
    });

    if (resp.status === 200 && resp.data.StatusId === 1) {
      return {
        batchId: msg.batchId,
        messageId: msg.messageId,
        successfullySent: true,
        isRetryable: false,
        errorMessage: null,
        inforuRequestId: resp.data.RequestId
      };
    }

    return {
      batchId: msg.batchId,
      messageId: msg.messageId,
      successfullySent: false,
      isRetryable: resp.data.StatusId !== 1,
      errorMessage: resp.data.DetailedDescription || resp.data.StatusDescription
    };
  } catch (err) {
    const isRetryable = err.response && err.response.status >= 500;
    return {
      batchId: msg.batchId,
      messageId: msg.messageId,
      successfullySent: false,
      isRetryable: isRetryable,
      errorMessage: err.message
    };
  }
}

function getSegments(text) {
  return text.length <= 160 ? 1 : Math.ceil(text.length / 153);
}

module.exports = { sendMessages };
