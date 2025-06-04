const userService = require("../services/userService");

const signup = async (req, res, next) => {
    try {
        const { first_name, last_name, email, phone, password, role, device, device_id, ip_address } = req.body;
        const result = await userService.signupUser({ first_name, last_name, email, phone, password, role, device, device_id, ip_address });
        return res.status(201).json({
            status: "success",
            code: 201,
            message: "Verification code sent and Please check your email or phone",
            data: result
        });
    } catch (error) {
        console.error("Error during signup:", error);
        next(error);
    }
};

const confirmSignup = async (req, res, next) => {
    try {
        const { phone, email, role, signup_code, password, device, email_code, phone_code, device_id, ip_address } = req.body;
        const result = await userService.confirmSignup({ phone, email, role, signup_code, password, device, email_code, phone_code, device_id, ip_address });
        return res.status(200).json({
            status: "success",
            code: 200,
            data: result
        });
    } catch (error) {
        console.error("Error during signup confirmation:", error);
        next(error)
    }
};

const signInWithPassword = async (req, res, next) => {
    try {
        const { email, phone, username, password, role, device, device_id, ip_address } = req.body;
        console.log("Device type received:", device);
        const result = await userService.signIn({ email, phone, username, password, role, device, device_id, ip_address });
        return res.status(200).json({
            status: "success",
            code: 200,
            message: "Signin successful",
            data: result
        });
    } catch (error) {
        console.error("Signin error:", error);
        next(error);
    }
};

const sendOTP = async (req, res, next) => {
    try {
        const { email, phone, device, role, device_id, ip_address } = req.body;
        const data = await userService.sendOTP(email, phone, device, role, device_id, ip_address);
        res.status(200).json({
            status: "success",
            code: 200,
            message: "OTP sent successfully",
            data
        });
    } catch (error) {
        console.error('sendOTP error:', error);
        next(error);
    }
};

const signInWithOTP = async (req, res, next) => {
    try {
        const { email, phone, otp, role, device, session, device_id, ip_address } = req.body;
        const data = await userService.verifyOTP(email, phone, otp, role, device, session, device_id, ip_address);
        res.status(200).json({
            status: "success",
            code: 200,
            message: 'OTP verified successfully',
            data
        });
    } catch (error) {
        console.error("signInWithOTP error:", error);
        next(error);
    }
};

const getUser = async (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(401).json({ message: "Unauthorized" });
        };
        const role = req.headers['role'];
        const device = req.headers['device'];
        const device_id = req.headers['device_id'];
        const ip_address = req.headers['ip_address'];
        const userData = await userService.getUser(req.user, role, device, device_id, ip_address);
        res.status(200).json({
            status: "success",
            code: 200,
            message: "User data fetched successfully",
            data: userData
        });
    } catch (error) {
        console.error('Get user error:', error);
        next(error);
    }
};

const forgotPassword = async (req, res, next) => {
    try {
        const { email, phone_number, role, device, device_id, ip_address } = req.body;
        const result = await userService.sendForgotPasswordOTP({ email, phone_number, role, device, device_id, ip_address });
        res.status(200).json({
            status: "success",
            code: 200,
            message: "Password reset OTP has been sent to your registered email or phone",
            result
        });
    } catch (error) {
        next(error);
    }
};

const resetPassword = async (req, res, next) => {
    try {
        const { email, phone_number, code, new_password, role, device, device_id, ip_address } = req.body;
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
        res.status(200).json({
            status: "success",
            code: 200,
            message: "Password has been successfully reset"
        });
    } catch (error) {
        next(error);
    }
};

const sessionStatus = async (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ message: "Unauthorized" });
    }
    const role = req.headers['role'];
    const device = req.headers['device'];
    const device_id = req.headers['device_id'];
    const ip_address = req.headers['ip_address'];
    try {
        const result = await userService.checkSessionStatus(req.user, role, device, device_id, ip_address);
        return res.status(200).json({
            status: "success",
            code: 200,
            message: "Active session fetched successfully",
            data: result
        });
    } catch (error) {
        next(error);
    }
};

const logoutSession = async (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ message: "Unauthorized" });
    };
    const { role, device, device_id, ip_address } = req.body;
    try {
        const accessToken = req.headers.authorization?.split(' ')[1];
        const user_id = req.user?.username;
        await userService.logout(accessToken, user_id, role, device, device_id, ip_address);
        return res.status(200).json({
            status: "success",
            code: 200,
            message: "Logged out successfully"
        });
    } catch (error) {
        next(error);
    }
};

const resetSession = async (req, res, next) => {
    try {
        const { username, email, phone, password, role, device, device_id, ip_address } = req.body;
        const result = await userService.resetSession(username, email, phone, password, role, device, device_id, ip_address);
        return res.status(200).json({
            status: "success",
            code: 200,
            message: 'Logged in successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
};

const generateTokens = async (req, res, next) => {
    const { refresh_token, username, role, device, device_id, ip_address } = req.body;
    try {
        const tokens = await userService.generateTokens(refresh_token, username, role, device, device_id, ip_address);
        res.json({
            status: "success",
            code: 200,
            message: "Tokens generated successfully",
            data: tokens
        });
    } catch (error) {
        console.error("Error generating tokens:", error);
        next(error);
    }
};

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
    generateTokens
};