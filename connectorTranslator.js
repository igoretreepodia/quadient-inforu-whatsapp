function translateRequest(requestToParse, universalUrl) {
  const { uri, body } = requestToParse;
  const response = {};

  if (!uri.startsWith(universalUrl)) {
    throw new Error('Invalid callback URI');
  }

  const path = uri.substring(universalUrl.length);
  console.log('Path: ' + path);

  // Determine if status callback (path starts with batchId/messageId)
  const segments = path.split('/').filter(Boolean);
  console.log('Segments: ' + segments);

  if (segments.length >= 2 && !isNaN(segments[0]) && !isNaN(segments[1])) {
    // This is a delivery report callback
    const batchId = Number(segments[0]);
    const messageId = Number(segments[1]);

    let deliveryData;
    try {
      deliveryData = Array.isArray(body) ? body : JSON.parse(body);
      if (!Array.isArray(deliveryData)) {
        deliveryData = [deliveryData];
      }
    } catch (err) {
      console.error('Failed to parse delivery notification:', err);
      response.customHttpResponse = { statusCode: 400 };
      return response;
    }

    response.parsedDeliveryReports = deliveryData.map(item => ({
      batchId,
      messageId,
      rawStatusMeaning: item.Status,
      deliveryStatus: translateInforuStatus(item.Status),
      inforuId: item.InforuId,
      phoneNumber: item.PhoneNumber,
      customerMessageId: item.CustomerMessageId,
      notificationDate: item.NotificationDate
    }));
  } else {
    // This might be an incoming message callback
    // Note: Inforu documentation doesn't show incoming message format,
    // so this is a placeholder structure
    let messageData;
    try {
      messageData = typeof body === 'string' ? JSON.parse(body) : body;
    } catch (err) {
      console.error('Failed to parse incoming message:', err);
      response.customHttpResponse = { statusCode: 400 };
      return response;
    }

    response.parsedIncomingMessages = [{
      sender: messageData.From || messageData.PhoneNumber,
      recipient: messageData.To || messageData.SenderNumber,
      message: messageData.Body || messageData.OriginalMessage
    }];
  }

  return response;
}

function translateInforuStatus(status) {
  switch (status) {
    case 0: return 'Sent';
    case 2: return 'Delivered';
    case 4: return 'Read';
    case 6: return 'Clicked';
    case -2: return 'DeliveryFailed';
    case -4: return 'Blocked';
    default: return 'Unknown';
  }
}

module.exports = { translateRequest };
