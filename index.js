const functions = require('@google-cloud/functions-framework');
const { getAuthCredentials, getInforuConfig } = require('./configCache');
const { authorize } = require('./authorization');
const { sendMessages } = require('./connectorService');
const { translateRequest } = require('./connectorTranslator');

functions.http('whatsapp', (req, res) => {
    // ─── LOG EVERYTHING ─────────────────────────────────────────────────────────────
    console.log(`→ ${req.method} ${req.path}`);
    console.log('Headers:', JSON.stringify(req.headers));
    console.log('Query:', JSON.stringify(req.query));

    const raw = req.rawBody ? req.rawBody.toString() : '<no rawBody>';
    console.log('rawBody:', raw);
    console.log('parsed body:', JSON.stringify(req.body));
    // ────────────────────────────────────────────────────────────────────────────────

    const data = req.body;
    const response = { version: '1' };

    // 1. Authorization
    authorize(req).then(authorized => {
        if (!authorized) {
            return res.status(401).send('Unauthorized');
        }

        // 2. Send messages
        if (Array.isArray(data.messagesToSend) && data.messagesToSend.length > 0) {
            getInforuConfig().then(config => {
                if (!config) {
                    return res.status(500).send('Missing Inforu configuration');
                }
                sendMessages(config, data.messagesToSend, data.universalCallbackUrl)
                    .then(sentMessagesResults => {
                        response.sentMessagesResults = sentMessagesResults;
                        return res.json(response);
                    })
                    .catch(e => {
                        console.error('Error sending messages:', e);
                        return res.status(500).send(e.message || e);
                    });
            }).catch(e => {
                console.error('Error getting Inforu config:', e);
                return res.status(500).send(e.message || e);
            });
        } else
            // 3. Parse incoming or status callbacks
        if (data.requestToParse) {
            try {
                const parsed = translateRequest(
                    data.requestToParse,
                    data.universalCallbackUrl
                );
                response.parsedRequestResults = parsed;
                return res.json(response);
            } catch (e) {
                console.error('Error parsing request:', e);
                return res.status(400).send(e.message || e);
            }
        } else {
            return res.json(response);
        }
    }).catch(e => {
        console.error('Authorization error:', e);
        return res.status(500).send(e.message || e);
    });
});
