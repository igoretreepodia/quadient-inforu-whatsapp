const functions = require('@google-cloud/functions-framework');
const { getAuthCredentials, getTwilioConfig } = require('./configCache');
const { authorize } = require('./authorization');
const { sendMessages } = require('./connectorService');
const { translateRequest } = require('./connectorTranslator');

functions.http('whatsapp', (req, res) => {
  // ─── LOG EVERYTHING ─────────────────────────────────────────────────────────────
  // 1. Log HTTP method and path
  console.log(`→ ${req.method} ${req.path}`);

  // 2. Log headers
  console.log('Headers:', JSON.stringify(req.headers));

  // 3. Log query parameters
  console.log('Query:', JSON.stringify(req.query));

  // 4. Log rawBody (always available as a Buffer)
  const raw = req.rawBody ? req.rawBody.toString() : '<no rawBody>';
  console.log('rawBody:', raw);

  // 5. Log parsed body (if JSON or form‐encoded)
  console.log('parsed body:', JSON.stringify(req.body));
  // ────────────────────────────────────────────────────────────────────────────────

  const data = req.body;
  const response = { version: '1' };

  // 1. Authorization
  authorize(req).then(authorized => {
    if(!authorized){
        return res.status(401).send('Unauthorized');
    }

    // 2. Send messages
    if (Array.isArray(data.messagesToSend) && data.messagesToSend.length > 0) {
        getTwilioConfig().then(config => {
            if (!config) {
                return res.status(500).send('Missing Twilio configuration');
            }
            sendMessages(config, data.messagesToSend, data.universalCallbackUrl)
            .then(sentMessagesResults => {
                response.sentMessagesResults = sentMessagesResults;
                return res.json(response);
            })
            .catch(e => {
                return res.status(500).send(e);
            });
        }).catch(e => {
            console.error(e);
            return res.status(500).send(e);
        });
    } else
    // 3. Parse incoming or status callbacks
    if (data.requestToParse) {
        const parsed = translateRequest(
        data.requestToParse,
        data.universalCallbackUrl
        );
        response.parsedRequestResults = parsed;
        return res.json(response);
    } else {
        return res.json(response);
    }
  }).catch(e => {
    console.error(e);
    return res.status(500).send(e);
  });;
});
