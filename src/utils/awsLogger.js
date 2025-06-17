const { Logger } = require('@aws-lambda-powertools/logger');

const createLogger = (serviceName) => new Logger({
    serviceName,
    environment: process.env.NODE_ENV || 'dev',
});

const defaultLogger = createLogger('App');

const logRequest = (req, context = {}, loggerInstance = defaultLogger) => {
    const { method, headers, body, path, query, params } = req;
    const safeBody = { ...body };
    if (safeBody.password) safeBody.password = '******';
    if (safeBody.new_password) safeBody.new_password = '******';
    if (safeBody.signup_code) safeBody.signup_code = '******';
    if (safeBody.email_code) safeBody.email_code = '******';
    if (safeBody.otp) safeBody.otp = '******';
    if (safeBody.code) safeBody.code = '******';
    if (safeBody.refresh_token) safeBody.refresh_token = '******';

    const safeHeaders = { ...headers };
    if (safeHeaders.authorization) safeHeaders.authorization = '******';
    loggerInstance.addContext(context);
    loggerInstance.info('Incoming request', {
        method,
        path,
        query,
        params,
        headers: safeHeaders,
        body: safeBody,
    });
};

module.exports = {
    createLogger,
    defaultLogger,
    logRequest,
};
