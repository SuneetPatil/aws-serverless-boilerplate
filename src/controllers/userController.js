const userService = require("../services/userService");
const { logRequest, createLogger } = require('../utils/awsLogger');
const logger = createLogger('userController');

const signup = async (req, res, next) => {
    try {
        logRequest(req, req.lambdaContext, logger);
        const { first_name, last_name, email, phone_number, password, role, device, device_id, ip_address } = req.body;
        logger.appendKeys({ role, device, device_id, ip_address });
        const result = await userService.signupUser({ first_name, last_name, email, phone_number, password, role, device, device_id, ip_address });
        logger.info("Signup successful", { email, phone_number });
        return res.status(201).json({
            status: "success",
            code: 201,
            message: "Verification code sent and Please check your email or phone",
            data: result
        });
    } catch (error) {
        logger.error({
            message: error.message,
            code: error.statusCode,
            stack: error.stack,
        });
        next(error);
    }
};

const confirmSignup = async (req, res, next) => {
    try {
        logRequest(req, req.lambdaContext, logger);
        const { phone_number, email, role, signup_code, password, device, email_code, phone_code, device_id, ip_address } = req.body;
        logger.appendKeys({ role, device, device_id, ip_address });
        const result = await userService.confirmSignup({ phone_number, email, role, signup_code, password, device, email_code, phone_code, device_id, ip_address });
        logger.info("Signup confirmed successfully");
        return res.status(200).json({
            status: "success",
            code: 200,
            data: result
        });
    } catch (error) {
        logger.error({
            message: error.message,
            code: error.statusCode,
            stack: error.stack
        });
        next(error)
    }
};

const signInWithPassword = async (req, res, next) => {
    try {
        logRequest(req, req.lambdaContext, logger);
        const { email, phone_number, username, password, role, device, device_id, ip_address } = req.body;
        logger.appendKeys({ role, device, device_id, ip_address });
        const result = await userService.signIn({ email, phone_number, username, password, role, device, device_id, ip_address });
        logger.info('Sign-in successful', { username });
        return res.status(200).json({
            status: "success",
            code: 200,
            message: "Signin successful",
            data: result
        });
    } catch (error) {
        logger.error({
            message: error.message,
            code: error.statusCode,
            stack: error.stack,
        });
        next(error);
    }
};

const sendOTP = async (req, res, next) => {
    try {
        logRequest(req, req.lambdaContext, logger);
        const { email, phone_number, device, role, device_id, ip_address } = req.body;
        logger.appendKeys({ role, device, device_id, ip_address });
        const data = await userService.sendOTP(email, phone_number, device, role, device_id, ip_address);
        logger.info("OTP sent successfully");
        res.status(200).json({
            status: "success",
            code: 200,
            message: "OTP sent successfully",
            data
        });
    } catch (error) {
        logger.error({
            message: error.message,
            code: error.statusCode,
            stack: error.stack,
        });
        next(error);
    }
};

const signInWithOTP = async (req, res, next) => {
    try {
        logRequest(req, req.lambdaContext, logger);
        const { email, phone_number, otp, role, device, session, device_id, ip_address } = req.body;
        logger.appendKeys({ role, device, device_id, ip_address });
        const data = await userService.verifyOTP(email, phone_number, otp, role, device, session, device_id, ip_address);
        logger.info("OTP verified successfully");
        res.status(200).json({
            status: "success",
            code: 200,
            message: 'OTP verified successfully',
            data
        });
    } catch (error) {
        logger.error({
            message: error.message,
            code: error.statusCode,
            stack: error.stack,
        });
        next(error);
    }
};

const getUser = async (req, res, next) => {
    try {
        logRequest(req, req.lambdaContext, logger);
        if (!req.user) {
            return res.status(401).json({ message: "Unauthorized" });
        };
        const role = req.headers['role'];
        const device = req.headers['device'];
        const device_id = req.headers['device_id'];
        const ip_address = req.headers['ip_address'];
        logger.appendKeys({ role, device, device_id, ip_address });
        const userData = await userService.getUser(req.user, role, device, device_id, ip_address);
        logger.info("User data fetched", { username: userData.username });
        res.status(200).json({
            status: "success",
            code: 200,
            message: "User data fetched successfully",
            data: userData
        });
    } catch (error) {
        logger.error({
            message: error.message,
            code: error.statusCode,
            stack: error.stack,
        });
        next(error);
    }
};

const forgotPassword = async (req, res, next) => {
    try {
        logRequest(req, req.lambdaContext, logger);
        const { email, phone_number, role, device, device_id, ip_address } = req.body;
        logger.appendKeys({ role, device, device_id, ip_address });
        const result = await userService.sendForgotPasswordOTP({ email, phone_number, role, device, device_id, ip_address });
        logger.info("Forgot password OTP sent successfully");
        res.status(200).json({
            status: "success",
            code: 200,
            message: "Password reset OTP has been sent to your registered email or phone",
            result
        });
    } catch (error) {
        logger.error({
            message: error.message,
            code: error.statusCode,
            stack: error.stack,
        });
        next(error);
    }
};

const resetPassword = async (req, res, next) => {
    try {
        logRequest(req, req.lambdaContext, logger);
        const { email, phone_number, code, new_password, role, device, device_id, ip_address } = req.body;
        logger.appendKeys({ role, device, device_id, ip_address });
        await userService.confirmForgotPassword({
            email,
            phone_number,
            code,
            new_password,
            role,
            device,
            device_id,
            ip_address
        });
        logger.info("Password reset successfully");
        res.status(200).json({
            status: "success",
            code: 200,
            message: "Password has been successfully reset"
        });
    } catch (error) {
        logger.error({
            message: error.message,
            code: error.statusCode,
            stack: error.stack,
        });
        next(error);
    }
};

const sessionStatus = async (req, res, next) => {
    logRequest(req, req.lambdaContext, logger);
    if (!req.user) {
        return res.status(401).json({ message: "Unauthorized" });
    }
    const role = req.headers['role'];
    const device = req.headers['device'];
    const device_id = req.headers['device_id'];
    const ip_address = req.headers['ip_address'];
    logger.appendKeys({ role, device, device_id, ip_address });
    try {
        const result = await userService.checkSessionStatus(req.user, role, device, device_id, ip_address);
        logger.info("Session status checked successfully", { user: req.user.username });
        return res.status(200).json({
            status: "success",
            code: 200,
            message: "Active session fetched successfully",
            data: result
        });
    } catch (error) {
        logger.error({
            message: error.message,
            code: error.statusCode,
            stack: error.stack,
        });
        next(error);
    }
};

const logoutSession = async (req, res, next) => {
    try {
        logRequest(req, req.lambdaContext, logger);
        if (!req.user) {
            return res.status(401).json({ message: "Unauthorized" });
        };
        const { role, device, device_id, ip_address } = req.body;
        logger.appendKeys({ role, device, device_id, ip_address });

        const accessToken = req.headers.authorization?.split(' ')[1];
        const user_id = req.user?.username;
        await userService.logout(accessToken, user_id, role, device, device_id, ip_address);
        logger.info("User logged out", { user_id });
        return res.status(200).json({
            status: "success",
            code: 200,
            message: "Logged out successfully"
        });
    } catch (error) {
        logger.error({
            message: error.message,
            code: error.statusCode,
            stack: error.stack,
        });
        next(error);
    }
};

const resetSession = async (req, res, next) => {
    try {
        logRequest(req, req.lambdaContext, logger);
        const { username, email, phone_number, password, role, device, device_id, ip_address } = req.body;
        logger.appendKeys({ role, device, device_id, ip_address });
        const result = await userService.resetSession(username, email, phone_number, password, role, device, device_id, ip_address);
        logger.info("Session reset successfully");
        return res.status(200).json({
            status: "success",
            code: 200,
            message: 'Logged in successfully',
            data: result
        });
    } catch (error) {
        logger.error({
            message: error.message,
            code: error.statusCode,
            stack: error.stack,
        });
        next(error);
    }
};

const generateTokens = async (req, res, next) => {
    try {
        logRequest(req, req.lambdaContext, logger);
        const { refresh_token, username, role, device, device_id, ip_address } = req.body;
        logger.appendKeys({ role, device, device_id, ip_address });
        const tokens = await userService.generateTokens(refresh_token, username, role, device, device_id, ip_address);
        logger.info("Tokens generated", { username });
        res.json({
            status: "success",
            code: 200,
            message: "Tokens generated successfully",
            data: tokens
        });
    } catch (error) {
        logger.error({
            message: error.message,
            code: error.statusCode,
            stack: error.stack,
        });
        next(error);
    }
};

const getUploadUrl = async (req, res, next) => {
    try {
        logRequest(req, req.lambdaContext, logger);
        const { file_type, folder, file_name, role, device, device_id, ip_address } = req.body;
        logger.appendKeys({ role, device, device_id, ip_address });
        logger.info("Generating pre-signed URL for file upload");
        const { uploadURL, fileUrl, key } = userService.generatePreSignedUrl(file_type, folder, file_name, role, device, device_id, ip_address);
        logger.info("Pre-signed URL generated successfully");
        res.status(200).json({ uploadURL, fileUrl, key });
    } catch (error) {
        logger.error({
            message: error.message,
            code: error.statusCode,
            stack: error.stack,
        });
        next(error);
    }
};

const assignImage = async (req, res, next) => {
    try {
        logRequest(req, req.lambdaContext, logger);
        const { username, image_url, role, device, device_id, ip_address } = req.body;
        logger.appendKeys({ role, device, device_id, ip_address });
        await userService.assignImage(username, image_url, role, device, device_id, ip_address);
        logger.info("Image assigned successfully", { username });
        res.status(200).json({
            status: "success",
            code: 200,
            message: "Profile picture uploaded successfully", 
        });
    } catch (error) {
        logger.error({
            message: error.message,
            code: error.statusCode,
            stack: error.stack,
        });
        next(error);
    }
}

module.exports = {
    signup,
    confirmSignup,
    signInWithPassword,
    getUser,
    sendOTP,
    signInWithOTP,
    forgotPassword,
    resetPassword,
    sessionStatus,
    logoutSession,
    resetSession,
    generateTokens,
    getUploadUrl,
    assignImage
};