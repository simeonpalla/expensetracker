// health.js

const { withLogging } = require('./_lib');

exports.handler = withLogging('health', async function () {
    return {
        statusCode: 200,
        body: JSON.stringify({ message: 'BFF working' })
    };
});
