const axios = require('axios');
const querystring = require('querystring');

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
 * Inspects msg.message. If it’s JSON with a "template" field, delegate to sendTemplateMessage.
 * Otherwise, delegate to sendFreeformMessage.
 */
async function sendSingle(config, msg, callbackUrl) {
  let parsed;
  try {
    parsed = JSON.parse(msg.message);
  } catch (_) {
    // Not JSON → free-form
    return sendFreeformMessage(config, msg, callbackUrl);
  }

  if (parsed && parsed.template) {
    return sendTemplateMessage(config, msg, callbackUrl);
  }
  return sendFreeformMessage(config, msg, callbackUrl);
}

/**
 * Fetches a template SID by name via Twilio Content API.
 * Returns null if not found.
 */
async function fetchTemplateSid(config, templateName) {
  const url = `https://content.twilio.com/v2/Content?Channel=whatsapp&ContentName=${encodeURIComponent(templateName)}`;
  const auth = Buffer.from(`${config.apiSid}:${config.apiSecret}`).toString('base64');

  try {
    const resp = await axios.get(url, {
      headers: { Authorization: `Basic ${auth}` }
    });
    const contents = resp.data.contents || [];
    return contents.length > 0 ? contents[0].sid : null;
  } catch (err) {
    throw new Error(`Failed to fetch SID for template "${templateName}": ${err.message}`);
  }
}

/**
 * Sends a free-form (“Body”) WhatsApp message via Twilio.
 */
async function sendFreeformMessage(config, msg, callbackUrl) {
  console.log(`Sending freeform message: ${msg.message}`);
  const url = `${config.baseUrl}/2010-04-01/Accounts/${config.accountSid}/Messages.json`;
  const auth = Buffer.from(`${config.apiSid}:${config.apiSecret}`).toString('base64');

  const form = {
    Body: msg.message,
    To: `whatsapp:${msg.recipient}`,
    From: `whatsapp:${msg.sender}`,
    StatusCallback: `${callbackUrl}/${msg.batchId}/${msg.messageId}`
  };

  try {
    const resp = await axios.post(url, querystring.stringify(form), {
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    if (resp.status === 201) {
      const data = resp.data;
      const ok = ['queued', 'accepted'].includes(data.status);
      return {
        batchId: msg.batchId,
        messageId: msg.messageId,
        successfullySent: ok,
        isRetryable: false,
        errorMessage: ok ? null : data.message
      };
    }

    return {
      batchId: msg.batchId,
      messageId: msg.messageId,
      successfullySent: false,
      isRetryable: true,
      errorMessage: resp.statusText
    };
  } catch (err) {
    const isInsuff = err.response && err.response.data && err.response.data.code === 30002;
    return {
      batchId: msg.batchId,
      messageId: msg.messageId,
      successfullySent: false,
      isRetryable: isInsuff,
      errorMessage: err.message
    };
  }
}

/**
 * Sends a template-based WhatsApp message via Twilio.
 * Expects msg.message to be a JSON string containing a top-level "template" object.
 */
async function sendTemplateMessage(config, msg, callbackUrl) {
  console.log(`Sending template message: ${msg.message}`);
  const url = `${config.baseUrl}/2010-04-01/Accounts/${config.accountSid}/Messages.json`;
  const auth = Buffer.from(`${config.apiSid}:${config.apiSecret}`).toString('base64');

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
  if (!templatePayload || !templatePayload.name) {
    console.log('Template name is missing');
    return {
      batchId: msg.batchId,
      messageId: msg.messageId,
      successfullySent: false,
      isRetryable: false,
      errorMessage: 'Template name is missing'
    };
  }

  // 1) Fetch SID
  let templateSid;
  try {
    templateSid = await fetchTemplateSid(config, templatePayload.name);
  } catch (err) {
    return {
      batchId: msg.batchId,
      messageId: msg.messageId,
      successfullySent: false,
      isRetryable: false,
      errorMessage: err.message
    };
  }

  if (!templateSid) {
    return {
      batchId: msg.batchId,
      messageId: msg.messageId,
      successfullySent: false,
      isRetryable: false,
      errorMessage: `Template "${templatePayload.name}" not found`
    };
  }

  // 2) Build ContentVariables only if components/body/parameters exist
  let variablesMap = {};
  if (Array.isArray(templatePayload.components)) {
    for (const comp of templatePayload.components) {
      if (comp.type === 'body' && Array.isArray(comp.parameters)) {
        comp.parameters.forEach((paramObj, idx) => {
          if (paramObj.type === 'text') {
            variablesMap[String(idx + 1)] = paramObj.text || '';
          }
        });
      }
    }
  }

  // 3) Construct form. Omit ContentVariables if empty.
  const form = {
    To: `whatsapp:${msg.recipient}`,
    From: `whatsapp:${msg.sender}`,
    StatusCallback: `${callbackUrl}/${msg.batchId}/${msg.messageId}`,
    ContentSid: templateSid
  };
  if (Object.keys(variablesMap).length > 0) {
    form.ContentVariables = JSON.stringify(variablesMap);
  }

  try {
    const resp = await axios.post(url, querystring.stringify(form), {
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    if (resp.status === 201) {
      const data = resp.data;
      const ok = ['queued', 'accepted'].includes(data.status);
      return {
        batchId: msg.batchId,
        messageId: msg.messageId,
        successfullySent: ok,
        isRetryable: false,
        errorMessage: ok ? null : data.message
      };
    }

    return {
      batchId: msg.batchId,
      messageId: msg.messageId,
      successfullySent: false,
      isRetryable: true,
      errorMessage: resp.statusText
    };
  } catch (err) {
    const isInsuff = err.response && err.response.data && err.response.data.code === 30002;
    return {
      batchId: msg.batchId,
      messageId: msg.messageId,
      successfullySent: false,
      isRetryable: isInsuff,
      errorMessage: err.message
    };
  }
}

async function sendSingle_old(config, msg, callbackUrl) {
  const url = `${config.baseUrl}/2010-04-01/Accounts/${config.accountSid}/Messages.json`;
  const auth = Buffer.from(`${config.apiSid}:${config.apiSecret}`).toString('base64');
  const form = {
    Body: msg.message,
    To: `whatsapp:${msg.recipient}`,
    From: `whatsapp:${msg.sender}`,
    StatusCallback: `${callbackUrl}/${msg.batchId}/${msg.messageId}`
  };

  try {
    const resp = await axios.post(url, querystring.stringify(form), {
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    if (resp.status === 201) {
      const data = resp.data;
      const ok = ['queued','accepted'].includes(data.status);
      return { batchId: msg.batchId, messageId: msg.messageId, successfullySent: ok, isRetryable: false, errorMessage: ok ? null : data.message };
    }
    return { batchId: msg.batchId, messageId: msg.messageId, successfullySent: false, isRetryable: true, errorMessage: resp.statusText };
  } catch (err) {
    const isInsuff = err.response && err.response.data.code === 30002;
    return { batchId: msg.batchId, messageId: msg.messageId, successfullySent: false, isRetryable: isInsuff, errorMessage: err.message };
  }
}

function getSegments(text) {
  return text.length <= 160 ? 1 : Math.ceil(text.length / 153);
}

module.exports = { sendMessages };