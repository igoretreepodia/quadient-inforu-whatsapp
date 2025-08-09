const querystring = require('querystring');

function translateRequest(requestToParse, universalUrl) {
  const { uri, body } = requestToParse;
  const response = {};

  if (!uri.startsWith(universalUrl)) {
    throw new Error('Invalid callback URI');
  }
  const path = uri.substring(universalUrl.length);
  let data = body;
  if (!data) {
    const parts = path.split('?');
    if (parts.length !== 2) {
      response.customHttpResponse = { statusCode: 400 };
      return response;
    }
    data = parts[1];
  }
  console.log('Data: ' + JSON.stringify(data));
  const params = querystring.parse(data);
  console.log('Params: ' + JSON.stringify(params));
  console.log('Path: ' + path);
  
  // Determine if status callback (path starts with batchId/messageId)
  const segments = path.split('/').filter(Boolean);
  console.log('Segments: ' + segments);
  
  if (segments.length >= 2 && !isNaN(segments[0]) && !isNaN(segments[1])) {
    const batchId = Number(segments[0]);
    const messageId = Number(segments[1]);
    response.parsedDeliveryReports = [{
      batchId,
      messageId,
      rawStatusMeaning: params.MessageStatus,
      deliveryStatus: translateStatus(params.MessageStatus)
    }];
  } else {
    response.parsedIncomingMessages = [{
      sender: params.From,
      recipient: params.To,
      message: params.Body
    }];
  }
  return response;
}

function translateStatus(status) {
  switch (status) {
    case 'accepted':
    case 'queued':
    case 'sending':
      return 'Processing';
    case 'sent': return 'Sent';
    case 'delivered': return 'Delivered';
    case 'undelivered': return 'DeliveryFailed';
    case 'failed': return 'Failed';
    case 'read': return 'Read';
    default: return 'Unknown';
  }
}

module.exports = { translateRequest };