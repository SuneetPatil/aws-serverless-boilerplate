const {
    CognitoIdentityProviderClient,
    InitiateAuthCommand,
    RespondToAuthChallengeCommand,
    AdminConfirmSignUpCommand,
    AdminGetUserCommand,
    AdminUpdateUserAttributesCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const { cognito, CLIENTS } = require("../config/cognito");
const { generateSecretHash } = require("../utils/secretHash");
const { v4: uuidv4 } = require("uuid");
const db = require('../db/sequelize.db');
const { User, Session } = db;
const { AppError, BadRequestError, NotFoundError, ConflictError, InternalServerError, VerificationError, SessionError } = require('../utils/errorHandler');

const checkCognitoUserExists = async (identifier, role, device) => {
    try {
        const clientConfig = CLIENTS[device]?.[role];
        if (!clientConfig) {
            throw new BadRequestError('Invalid client configuration');
        }
        let filter;
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
            filter = `email = '${identifier}'`;
        } else if (/^\+?[1-9]\d{1,14}$/.test(identifier)) {
            filter = `phone_number = '${identifier}'`;
        } else if (/^[a-zA-Z0-9]{8}$/.test(identifier)) {
            filter = `username = '${identifier}'`;
        } else {
            throw new BadRequestError("Invalid identifier format");
        }
        const params = {
            UserPoolId: clientConfig.USER_POOL_ID,
            Filter: filter,
            Limit: 10,
        };
        const data = await cognito.listUsers(params).promise();
        const users = data.Users || [];
        const matchedUser = users.find(user => {
            const roleAttr = user.Attributes.find(attr =>
                attr.Name === 'custom:role' || attr.Name === 'role'
            );
            return roleAttr && roleAttr.Value === role;
        });
        if (!matchedUser) return false;
        const userDetails = {
            username: matchedUser.Username,
            status: matchedUser.UserStatus,
            enabled: matchedUser.Enabled,
            createdAt: matchedUser.UserCreateDate,
            attributes: matchedUser.Attributes.reduce((acc, attr) => {
                acc[attr.Name] = attr.Value;
                return acc;
            }, {})
        };
        return {
            exists: true,
            user: userDetails
        };
    } catch (err) {
        console.error("Error checking Cognito user existence:", err);
        throw new BadRequestError("Failed to check if user exists in Cognito");
    }
};

async function confirmUser(username, role, device) {
    const clientConfig = CLIENTS[device]?.[role];
    if (!clientConfig) throw new BadRequestError("Invalid device or role");
    const client = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });
    const getUserCommand = new AdminGetUserCommand({
        Username: username,
        UserPoolId: clientConfig.USER_POOL_ID,
    });
    try {
        const userData = await client.send(getUserCommand);
        if (userData.UserStatus === "CONFIRMED") {
            console.log(`User '${username}' is already confirmed.`);
            return;
        }
        //Confirm user if needed
        const confirmCommand = new AdminConfirmSignUpCommand({
            Username: username,
            UserPoolId: clientConfig.USER_POOL_ID,
        });
        await client.send(confirmCommand);
        console.log(`User '${username}' confirmed successfully.`);
    } catch (err) {
        console.error("Error checking or confirming user:", err);
        throw err;
    }
}

// Validation functions
function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePhone(phone) {
    return /^\+\d{10,15}$/.test(phone);
}

function getUsernameAndAttribute(input) {
    if (validateEmail(input)) return { username: input, loginAttribute: 'email' };
    if (validatePhone(input)) return { username: input, loginAttribute: 'phone_number' };
    return null;
}

async function verifyUserAttribute(username, role, device, loginAttribute) {
    try {
        const cognitoClient = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });
        const clientConfig = CLIENTS[device]?.[role];
        if (!clientConfig) throw new BadRequestError("Invalid device or role");
        const userData = await cognitoClient.send(
            new AdminGetUserCommand({
                UserPoolId: clientConfig.USER_POOL_ID,
                Username: username
            })
        );
        const isAlreadyVerified = userData.UserAttributes?.some(
            attr => attr.Name === `${loginAttribute}_verified` && attr.Value === 'true'
        );
        if (isAlreadyVerified) {
            console.log(`Attribute ${loginAttribute} is already verified for user ${username}`);
            return;
        }
        //mark the attribute as verified
        await cognitoClient.send(
            new AdminUpdateUserAttributesCommand({
                UserPoolId: clientConfig.USER_POOL_ID,
                Username: username,
                UserAttributes: [
                    {
                        Name: `${loginAttribute}_verified`,
                        Value: 'true'
                    }
                ]
            })
        );
        console.log(`Successfully verified ${loginAttribute} for user ${username}`);
    } catch (error) {
        console.error(`Error verifying ${loginAttribute} for user ${username}:`, error);
        throw new BadRequestError(`Failed to verify ${loginAttribute}`);
    }
};

const validatePassword = (password) => {
    const errors = [];
    // Check minimum length
    if (password.length < 8) {
        errors.push('at least 8 characters');
    }
    // Check for at least 1 number
    if (!/\d/.test(password)) {
        errors.push('at least 1 number');
    }
    // Check for at least 1 special character
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
        errors.push('at least 1 special character');
    }
    // Check for at least 1 uppercase letter
    if (!/[A-Z]/.test(password)) {
        errors.push('at least 1 uppercase letter');
    }
    // Check for at least 1 lowercase letter
    if (!/[a-z]/.test(password)) {
        errors.push('at least 1 lowercase letter');
    }
    // Check for leading/trailing spaces
    if (/^\s|\s$/.test(password)) {
        errors.push('no leading or trailing spaces');
    }
    return {
        isValid: errors.length === 0,
        message: errors.length > 0
            ? `Password must contain: ${errors.join(', ')}`
            : 'Password is valid'
    };
};

const signupUser = async ({ email, phone, password, role, device, first_name, last_name, device_id, ip_address }) => {
    try {
        // Basic Field Validations
        if (!first_name) throw new BadRequestError("First name is required");
        if (!last_name) throw new BadRequestError("Last name is required");
        if (!email) throw new BadRequestError("Email is required");
        if (!phone) throw new BadRequestError("Phone number is required");
        if (!password) throw new BadRequestError("Password is required");
        if (!role) throw new BadRequestError("Role is required");
        if (!device) throw new BadRequestError("Device is required");
        if (!device_id) throw new BadRequestError("Device ID is required");
        if (!ip_address) throw new BadRequestError("IP Address is required");
        if (!['browser', 'mobile'].includes(device)) {
            throw new BadRequestError("Device must be either 'browser' or 'mobile'");
        }
        // Email Format Validation
        if (!validateEmail(email)) {
            throw new BadRequestError("Invalid email format");
        }
        // Phone Format Validation
        if (!validatePhone(phone)) {
            throw new BadRequestError("Invalid phone number format");
        }
        // Password Strength Validation
        const passwordCheck = validatePassword(password);
        if (!passwordCheck.isValid) {
            throw new BadRequestError(passwordCheck.message);
        }
        // Checking if user already exists in Cognito
        const emailCheck = email ? await checkCognitoUserExists(email, role, device) : { exists: false };
        const phoneCheck = phone ? await checkCognitoUserExists(phone, role, device) : { exists: false };
        if (emailCheck.exists && phoneCheck.exists) {
            throw new ConflictError("User already exists");
        } else if (emailCheck.exists) {
            throw new ConflictError("Email already exists");
        } else if (phoneCheck.exists) {
            throw new ConflictError("Phone number already exists");
        }
        // Generate 8-char UUID username
        const generateUUID = () => uuidv4().replace(/-/g, "").slice(0, 8);
        const username = generateUUID();
        // User attributes
        const userAttributes = [];
        if (email) userAttributes.push({ Name: "email", Value: email });
        if (phone) userAttributes.push({ Name: "phone_number", Value: phone });
        if (role) userAttributes.push({ Name: "custom:role", Value: role });
        const clientConfig = CLIENTS[device]?.[role];
        if (!clientConfig) throw new BadRequestError("Invalid device");
        const params = {
            ClientId: clientConfig.CLIENT_ID,
            Username: username,
            Password: password,
            SecretHash: generateSecretHash(username, clientConfig),
            UserAttributes: userAttributes,
        };
        const response = await cognito.signUp(params).promise();
        // Storing user in DB
        await User.create({
            id: username,
            cognito_sub: response.UserSub,
            email,
            phone,
            first_name,
            last_name,
            role,
        });
        console.log(`User ${username} signed up using IP Address: ${ip_address} and Device ID: ${device_id} successfully`);
        return {
            username: username,
            emailVerified: false,
            phoneVerified: false,
        };
    } catch (error) {
        console.error("Signup error:", error);
        if (error instanceof AppError) {
            throw error;
        }
        throw new InternalServerError("Signup failed due to an unexpected error");
    }
};

const confirmSignup = async ({ phone, email, role, signup_code, password, device, email_code, phone_code, device_id, ip_address, logoutPreviousSession = false }) => {
    if (!role) {
        throw new BadRequestError("Role is required");
    }
    if (!device) {
        throw new BadRequestError("Device is required");
    }
    if (!['browser', 'mobile'].includes(device)) {
        throw new BadRequestError("Device must be either 'browser' or 'mobile'");
    }
    if (!phone && !email) {
        throw new BadRequestError("Phone or Email is required");
    }
    if (email) {
        if (!validateEmail(email)) {
            throw new BadRequestError("Invalid email format");
        }
    }
    if (phone) {
        if (!validatePhone(phone)) {
            throw new BadRequestError("Invalid phone number format");
        }
    }
    if (!password) {
        throw new BadRequestError("Password is required");
    }
    const passwordCheck = validatePassword(password);
    if (!passwordCheck.isValid) {
        throw new BadRequestError(passwordCheck.message);
    }
    if (signup_code && !/^\d{6}$/.test(signup_code)) {
        throw new BadRequestError("Signup code must be a 6-digit number");
    }
    if (email_code && !/^\d{6}$/.test(email_code)) {
        throw new BadRequestError("Email verification code must be a 6-digit number");
    }
    if (phone_code && !/^\d{6}$/.test(phone_code)) {
        throw new BadRequestError("Phone verification code must be a 6-digit number");
    }
    if (!device_id) {
        throw new BadRequestError("Device ID is required");
    }
    if (!ip_address) {
        throw new BadRequestError("IP Address is required");
    }
    if (!['browser', 'mobile'].includes(device)) throw new BadRequestError("Invalid device type");
    const identifier = phone || email;
    if (!identifier) throw new BadRequestError("Email or phone is required");
    const clientConfig = CLIENTS[device]?.[role];
    if (!clientConfig) throw new BadRequestError("Invalid device");
    const existsInCognito = await checkCognitoUserExists(identifier, role, device);
    if (!existsInCognito.exists) throw new NotFoundError("User not found");
    const username = existsInCognito.user.username;
    const secretHash = generateSecretHash(username, clientConfig);
    let accessToken, idToken, refreshToken;
    const getUserVerificationStatus = async (accessToken) => {
        const userDetails = await cognito.getUser({ AccessToken: accessToken }).promise();
        const attrs = Object.fromEntries(userDetails.UserAttributes.map(a => [a.Name, a.Value]));
        return {
            hasEmail: !!attrs.email,
            hasPhone: !!attrs.phone_number,
            emailVerified: attrs.email_verified === 'true',
            phoneVerified: attrs.phone_number_verified === 'true',
            attributes: attrs
        };
    };
    const sendVerificationCodesIfNeeded = async (accessToken, attrs) => {
        if (attrs.email && attrs.email_verified !== 'true') {
            try {
                await cognito.getUserAttributeVerificationCode({
                    AccessToken: accessToken,
                    AttributeName: 'email',
                }).promise();
            } catch (err) {
                console.error("Failed to send email verification code:", err);
            }
        }
        if (attrs.phone_number && attrs.phone_number_verified !== 'true') {
            try {
                await cognito.getUserAttributeVerificationCode({
                    AccessToken: accessToken,
                    AttributeName: 'phone_number',
                }).promise();
            } catch (err) {
                console.error("Failed to send phone verification code:", err);
            }
        }
    };
    const sendTokensIfFullyVerified = async (username, device, refreshToken, logoutPreviousSession) => {
        const { hasEmail, hasPhone, emailVerified, phoneVerified } = await getUserVerificationStatus(accessToken);
        //No verifications needed (no email/phone or already verified)
        const noVerificationNeeded =
            (!hasEmail && !hasPhone) ||
            (hasEmail && emailVerified && !hasPhone) ||
            (!hasEmail && hasPhone && phoneVerified) ||
            (hasEmail && emailVerified && hasPhone && phoneVerified);
        if (noVerificationNeeded) {
            return await generateAndSendTokens(username, device, refreshToken, logoutPreviousSession);
        }
        //Need verification
        return { message: "Almost done! Complete the remaining verification to access your account." };
    };
    const generateAndSendTokens = async (username, device, refreshToken, logoutPreviousSession) => {
        // Get expiration times
        const tokenExpiry = parseInt(device === 'mobile'
            ? process.env.TOKEN_EXPIRY_MOBILE
            : process.env.TOKEN_EXPIRY_BROWSER);
        const refreshExpiry = parseInt(device === 'mobile'
            ? process.env.REFRESH_EXPIRY_MOBILE
            : process.env.REFRESH_EXPIRY_BROWSER);
        const refreshExpiresAt = new Date(Date.now() + refreshExpiry * 1000);
        // Check for existing active session
        const existingSession = await Session.findOne({
            where: {
                user_id: username,
                is_active: true
            }
        });
        if (existingSession) {
            if (!logoutPreviousSession) {
                throw new SessionError("An active session exists. Please confirm to logout from the previous device");
            }
        }
        // Create new session
        await Session.create({
            "session_id": uuidv4(),
            "user_id": username,
            "user-agent": device,
            "device_id": device_id,
            "ip_address": ip_address,
            "refresh_token": refreshToken,
            "created_at": new Date(),
            "expires_at": refreshExpiresAt,
            "is_active": true
        });
        return {
            message: "Login successful! You can now access your account.",
            username: username,
            access_token: accessToken,
            id_token: idToken,
            expires_in: tokenExpiry,
            refresh_token: refreshToken,
            refresh_expires_in: refreshExpiry,
            device: device
        };
    };
    if (signup_code) {
        try {
            await cognito.confirmSignUp({
                ClientId: clientConfig.CLIENT_ID,
                Username: username,
                ConfirmationCode: signup_code,
                SecretHash: secretHash,
            }).promise();
            await User.update({ is_active: true }, { where: { id: existsInCognito.user.username } });
        } catch (err) {
            console.error("Signup confirmation failed:", err);
            throw new BadRequestError("Signup confirmation failed");
        }
        // Authenticate after confirmation
        try {
            const authResult = await cognito.initiateAuth({
                ClientId: clientConfig.CLIENT_ID,
                AuthFlow: 'USER_PASSWORD_AUTH',
                AuthParameters: {
                    USERNAME: username,
                    PASSWORD: password,
                    SECRET_HASH: secretHash
                }
            }).promise();
            accessToken = authResult.AuthenticationResult.AccessToken;
            idToken = authResult.AuthenticationResult.IdToken;
            refreshToken = authResult.AuthenticationResult.RefreshToken;
        } catch (err) {
            console.error("Authentication failed:", err);
            throw new Error("Authentication failed. Please try again later.");
        }
        // Get user attributes
        const { attributes } = await getUserVerificationStatus(accessToken);
        await sendVerificationCodesIfNeeded(accessToken, attributes);
        // Check verification status and send tokens
        return await sendTokensIfFullyVerified(username, device, refreshToken, logoutPreviousSession);
    }
    if (email_code || phone_code) {
        try {
            const authResult = await cognito.initiateAuth({
                ClientId: clientConfig.CLIENT_ID,
                AuthFlow: 'USER_PASSWORD_AUTH',
                AuthParameters: {
                    USERNAME: username,
                    PASSWORD: password,
                    SECRET_HASH: secretHash
                }
            }).promise();
            accessToken = authResult.AuthenticationResult.AccessToken;
            idToken = authResult.AuthenticationResult.IdToken;
            refreshToken = authResult.AuthenticationResult.RefreshToken;
        } catch (err) {
            console.error("Authentication failed:", err);
            throw new Error(`Authentication failed: ${err.message}`);
        }
        // Verify email code if provided
        if (email_code) {
            try {
                await cognito.verifyUserAttribute({
                    AccessToken: accessToken,
                    AttributeName: 'email',
                    Code: email_code,
                }).promise();
            } catch (err) {
                console.error("Email verification failed:", err);
                throw new Error(`Email verification failed: ${err.message}`);
            }
        }
        // Verify phone code if provided
        if (phone_code) {
            try {
                await cognito.verifyUserAttribute({
                    AccessToken: accessToken,
                    AttributeName: 'phone_number',
                    Code: phone_code,
                }).promise();
            } catch (err) {
                console.error("Phone verification failed:", err);
                throw new Error(`Phone verification failed: ${err.message}`);
            }
        }
        return await sendTokensIfFullyVerified(username, device, refreshToken, logoutPreviousSession);
    }
};

const signIn = async ({ username, email, phone, password, role, device, device_id, ip_address, logoutPreviousSession = false }) => {
    try {
        // Validate device type
        if (!['browser', 'mobile'].includes(device)) {
            throw new BadRequestError("Invalid device type.");
        }
        // Validate presence of at least one login identifier
        if (!username && !email && !phone) {
            throw new BadRequestError("Please provide either username, email, or phone for login.");
        }
        if (!password) {
            throw new BadRequestError("Password is required to login");
        }
        if (!role) {
            throw new BadRequestError("Role is missing");
        }
        if (!device_id) {
            throw new BadRequestError("Device ID is missing");
        }
        if (!ip_address) {
            throw new BadRequestError("IP Address is missing");
        }
        const input = username || email || phone;
        if (!input) throw new BadRequestError("Username, email or phone is required");
        // Validate input identifier type
        const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
        const isPhone = /^\+?[1-9]\d{1,14}$/.test(input); // E.164 format
        const isUsername = /^[a-zA-Z0-9]{8}$/.test(input);
        // Validate email if provided
        if (email && !validateEmail(email)) {
            throw new BadRequestError("Invalid email format.");
        }
        // Validate username if provided
        const usernameRegex = /^[a-zA-Z0-9]{8}$/;
        if (username && !usernameRegex.test(username)) {
            throw new BadRequestError("Username must be exactly 8 alphanumeric characters");
        }
        // Validate phone if provided
        if (phone && !validatePhone(phone)) {
            throw new BadRequestError("Invalid Phone number format");
        }
        let identifierType, identifierValue;
        if (isEmail) {
            identifierType = "email";
            identifierValue = input;
        } else if (isPhone) {
            identifierType = "phone_number";
            identifierValue = input;
        } else if (isUsername) {
            identifierType = "username";
            identifierValue = input;
        } else {
            throw new BadRequestError("Invalid identifier format");
        }
        // Get client configuration
        const clientConfig = CLIENTS[device]?.[role];
        if (!clientConfig) throw new BadRequestError("Invalid device or role");
        // Check user existence
        const userExists = await checkCognitoUserExists(identifierValue, role, device);
        if (!userExists?.exists) throw new NotFoundError("User not found");
        const user = userExists.user;
        const { attributes } = user;
        await confirmUser(userExists.user.username, role, device);
        // Handle unverified attributes
        if (identifierType === "email" && attributes.email_verified !== "true") {
            await sendOTP(email, null, device, role, device_id, ip_address);
            throw new VerificationError("Email not verified. Verification code sent.", "email");
        }
        if (identifierType === "phone_number" && attributes.phone_number_verified !== "true") {
            await sendOTP(null, phone, device, role, device_id, ip_address);
            throw new VerificationError("Phone number not verified. Verification code sent.", "phone_number");
        }
        // Authenticate with Cognito
        const authResponse = await cognito.initiateAuth({
            AuthFlow: "USER_PASSWORD_AUTH",
            ClientId: clientConfig.CLIENT_ID,
            AuthParameters: {
                USERNAME: user.username,
                PASSWORD: password,
                SECRET_HASH: generateSecretHash(user.username, clientConfig),
            }
        }).promise();
        const tokens = authResponse.AuthenticationResult;
        // Check for existing active sessions
        const existingSession = await Session.findOne({
            where: {
                user_id: user.username,
                is_active: true
            }
        });
        if (existingSession) {
            if (!logoutPreviousSession) {
                throw new SessionError("An active session exists on another device. Confirm to logout from that device.");
            };
        }
        // Create new session
        const refreshExpiry = device === "browser"
            ? parseInt(process.env.BROWSER_REFRESH_EXPIRY || "3600")
            : parseInt(process.env.MOBILE_REFRESH_EXPIRY || "2592000");
        await Session.create({
            "session_id": uuidv4(),
            "user_id": user.username,
            "user-agent": device,
            "device_id": device_id,
            "ip_address": ip_address,
            "refresh_token": tokens.RefreshToken,
            "created_at": new Date(),
            "expires_at": new Date(Date.now() + refreshExpiry * 1000),
            "is_active": true
        });
        return {
            username: user.username,
            access_token: tokens.AccessToken,
            id_token: tokens.IdToken,
            expires_in: tokens.ExpiresIn,
            refresh_token: tokens.RefreshToken,
            refresh_expires_in: refreshExpiry,
            device: device,
        };
    } catch (error) {
        console.error('SignIn Error:', error);
        if (error instanceof AppError) {
            throw error;
        }
        throw new InternalServerError('Incorrect Password');
    }
};

const sendOTP = async (email, phone, device, role, device_id, ip_address) => {
    const allowedDevices = ['browser', 'mobile'];
    if (!device || !allowedDevices.includes(device)) {
        throw new BadRequestError("Invalid or missing device type. Allowed types: 'browser', 'mobile'");
    }
    // Validate role
    if (!role) {
        throw new BadRequestError("Role is required.");
    }
    // Validate at least email or phone is provided
    if (!email && !phone) {
        throw new BadRequestError("Please provide either an email or a phone number.");
    }
    // Validate email format if email provided
    if (email && !validateEmail(email)) {
        throw new BadRequestError("Invalid email format.");
    }
    // Validate phone format if phone provided
    if (phone && !validatePhone(phone)) {
        throw new BadRequestError("Invalid phone number format");
    }
    if (!device_id) throw new BadRequestError("Device ID is required");
    if (!ip_address) throw new BadRequestError("IP Address is required");
    const clientConfig = CLIENTS[device]?.[role];
    if (!clientConfig) throw new BadRequestError("Invalid device configuration");
    const input = (email || phone).trim();
    const userInfo = getUsernameAndAttribute(input);
    if (!userInfo) throw new BadRequestError('Invalid email or phone format');
    const userExists = await checkCognitoUserExists(input, role, device);
    if (!userExists?.exists) throw new NotFoundError("User not found");
    const username = userExists.user.username;
    await confirmUser(username, role, device);
    const secretHash = generateSecretHash(username, clientConfig);
    const params = {
        ClientId: clientConfig.CLIENT_ID,
        AuthFlow: 'CUSTOM_AUTH',
        AuthParameters: {
            USERNAME: username,
            SECRET_HASH: secretHash
        }
    };
    try {
        const cognitoClient = new CognitoIdentityProviderClient({
            region: process.env.AWS_REGION
        });
        const sendOTP = new InitiateAuthCommand(params);
        const response = await cognitoClient.send(sendOTP);
        if (!response.Session) {
            throw new BadRequestError("No session returned from Cognito");
        }
        console.log(`OTP initiation successful for user: ${username} using IP Address: ${ip_address} and Device ID: ${device_id}`);
        return {
            session: response.Session,
            challengeName: response.ChallengeName,
            challengeParameters: response.ChallengeParameters
        };
    } catch (error) {
        console.error('OTP initiation failed:', error);
        throw new BadRequestError('Failed to initiate OTP process');
    }
};

const verifyOTP = async (email, phone, otp, role, device, session, device_id, ip_address, logoutPreviousSession = false) => {
    const allowedDevices = ['browser', 'mobile'];
    if (!device || !allowedDevices.includes(device)) {
        throw new BadRequestError("Invalid or missing device type. Allowed types: 'browser', 'mobile'");
    }
    // Validate role
    if (!role) {
        throw new BadRequestError("Role is required.");
    }
    // Validate at least email or phone is provided
    if (!email && !phone) {
        throw new BadRequestError("Please provide either an email or a phone number.");
    }
    // Validate email format if email provided
    if (email && !validateEmail(email)) {
        throw new BadRequestError("Invalid email format.");
    }
    // Validate phone format if phone provided
    if (phone && !validatePhone(phone)) {
        throw new BadRequestError("Invalid phone number format");
    }
    if (!otp || !/^\d{6}$/.test(otp)) {
        throw new BadRequestError("OTP must be a 6-digit number");
    }
    if (!session) {
        throw new BadRequestError("Session is required for OTP verification");
    }
    if (!device_id) throw new BadRequestError("Device ID is required");
    if (!ip_address) throw new BadRequestError("IP Address is required");
    const clientConfig = CLIENTS[device]?.[role];
    if (!clientConfig) throw new BadRequestError("Invalid device configuration");
    const input = (email || phone).trim();
    const userInfo = getUsernameAndAttribute(input);
    if (!userInfo) throw new BadRequestError('Invalid email or phone format');
    const userExists = await checkCognitoUserExists(input, role, device);
    if (!userExists?.exists) throw new NotFoundError("User not found");
    const { loginAttribute } = userInfo;
    const username = userExists.user.username;
    const secretHash = generateSecretHash(username, clientConfig);
    const params = {
        ClientId: clientConfig.CLIENT_ID,
        ChallengeName: 'CUSTOM_CHALLENGE',
        Session: session,
        ChallengeResponses: {
            USERNAME: username,
            SECRET_HASH: secretHash,
            ANSWER: otp.trim()
        }
    };
    try {
        const cognitoClient = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });
        const response = await cognitoClient.send(new RespondToAuthChallengeCommand(params));
        if (!response.AuthenticationResult && !response.Session) {
            throw new BadRequestError('Unexpected response');
        }
        if (!userExists["verified"]?.[attribute]) {
            await verifyUserAttribute(username, role, device, loginAttribute);
        }
        const tokens = response.AuthenticationResult;
        const existingSession = await Session.findOne({
            where: {
                user_id: username,
                is_active: true
            }
        });
        if (existingSession) {
            if (!logoutPreviousSession) {
                throw new SessionError("An active session exists on another device. Confirm to logout from that device.");
            }
        }
        // Create new session
        const refreshExpiry = device === "browser"
            ? parseInt(process.env.REFRESH_EXPIRY_BROWSER || "3600")
            : parseInt(process.env.REFRESH_EXPIRY_MOBILE || "2592000");
        await Session.create({
            "session_id": uuidv4(),
            "user_id": username,
            "user-agent": device,
            "device_id": device_id,
            "ip_address": ip_address,
            "refresh_token": tokens.RefreshToken,
            "created_at": new Date(),
            "expires_at": new Date(Date.now() + refreshExpiry * 1000),
            "is_active": true
        });
        return {
            username: username,
            access_token: tokens.AccessToken,
            id_token: tokens.IdToken,
            expires_in: tokens.ExpiresIn,
            refresh_token: tokens.RefreshToken,
            refresh_expires_in: refreshExpiry,
            device: device,
        };
    } catch (error) {
        console.error('OTP verification error:', {
            name: error.name,
            message: error.message,
            code: error.code,
            metadata: error.$metadata
        });
        throw new BadRequestError(`OTP verification failed: ${error.message}`);
    }
};

const getUser = async (userDetails, role, device, device_id, ip_address) => {
    const client = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });
    if (!role) {
        throw new BadRequestError("Role is required");
    }
    if (!device || !['browser', 'mobile'].includes(device)) {
        throw new BadRequestError("Invalid device type. Allowed types: 'browser', 'mobile'");
    }
    if (!device_id) {
        throw new BadRequestError("Device ID is required");
    }
    if (!ip_address) {
        throw new BadRequestError("IP Address is required");
    }
    const user = await db.User.findOne({
        where: { id: userDetails.username }
    });
    if (!user) throw new Error('User not found');
    // Fetch verification status from Cognito
    let email_verified = "false";
    let phone_number_verified = "false";
    const command = new AdminGetUserCommand({
        UserPoolId: process.env.COGNITO_USER_POOL_ID,
        Username: userDetails.username,
    });
    const cognitoUser = await client.send(command);

    for (const attr of cognitoUser.UserAttributes) {
        if (attr.Name === "email_verified") email_verified = attr.Value;
        if (attr.Name === "phone_number_verified") phone_number_verified = attr.Value;
    }
    console.log(`User details fetched for ${user.id} using Device ID: ${device_id}, IP Address: ${ip_address}`);
    return {
        username: user.id,
        email: user.email,
        phone: user.phone,
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role,
        email_verified,
        phone_number_verified,
    };
};

const sendForgotPasswordOTP = async ({ email, phone_number, role, device, device_id, ip_address }) => {
    const allowedDevices = ['browser', 'mobile'];
    if (!device || !allowedDevices.includes(device)) {
        throw new BadRequestError("Invalid or missing device type. Allowed types: 'browser', 'mobile'");
    }
    // Validate role
    if (!role) {
        throw new BadRequestError("Role is required.");
    }
    // Validate at least email or phone is provided
    if (!email && !phone) {
        throw new BadRequestError("Please provide either an email or a phone number.");
    }
    // Validate email format if email provided
    if (email && !validateEmail(email)) {
        throw new BadRequestError("Invalid email format.");
    }
    // Validate phone format if phone provided
    if (phone_number && !validatePhone(phone_number)) {
        throw new BadRequestError("Invalid phone number format");
    }
    if (!device_id) throw new BadRequestError("Device ID is required");
    if (!ip_address) throw new BadRequestError("IP Address is required");
    // Validating client configuration
    const clientConfig = CLIENTS[device]?.[role];
    if (!clientConfig) throw new BadRequestError("Invalid device or role configuration");
    // Validateing input presence
    const input = (email || phone_number)?.trim();
    if (!input) throw new BadRequestError('Email or phone number is required');
    // Validating input format and get user attributes
    const userInfo = getUsernameAndAttribute(input);
    if (!userInfo) throw new BadRequestError('Invalid email or phone format');
    // Check if user exists and is verified in Cognito
    const userExists = await checkCognitoUserExists(input, role, device);
    if (!userExists?.exists) {
        throw new NotFoundError("User not found");
    }
    const username = userExists.user.username;
    const isVerified = userInfo.loginAttribute === 'email'
        ? userExists.user.attributes.email_verified === 'true'
        : userExists.user.attributes.phone_number_verified === 'true';
    if (!isVerified) {
        throw new BadRequestError(
            userInfo.loginAttribute === 'email'
                ? 'Email is not verified'
                : 'Phone number is not verified'
        );
    }
    try {
        //Initiating Cognito forgot password flow
        const cognitoResponse = await cognito.forgotPassword({
            ClientId: clientConfig.CLIENT_ID,
            Username: username,
            SecretHash: generateSecretHash(username, clientConfig),
        }).promise();
        console.log(`Forgot password OTP sent to ${userInfo.loginAttribute}: ${userInfo.username}`);
        console.log(`Fogotten OTP sent usingDevice ID: ${device_id}, IP Address: ${ip_address}`);
        return {
            deliveryMedium: cognitoResponse.CodeDeliveryDetails?.DeliveryMedium,
            destination: cognitoResponse.CodeDeliveryDetails?.Destination
        };
    } catch (error) {
        if (error.code === 'LimitExceededException') {
            throw new BadRequestError('Too many attempts. Please try again later.');
        }
        console.error('Error in forgot password flow:', error);
        throw new InternalServerError('Failed to send password reset OTP');
    }
};

const confirmForgotPassword = async ({ email, phone_number, code, new_password, role, device, device_id, ip_address }) => {
    const allowedDevices = ['browser', 'mobile'];
    // Validate device
    if (!device || !allowedDevices.includes(device)) {
        throw new BadRequestError("Invalid or missing device type. Allowed types: 'browser', 'mobile'");
    }
    // Validate role
    if (!role) {
        throw new BadRequestError("Role is required.");
    }
    // Validate at least email or phone is provided
    if (!email && !phone) {
        throw new BadRequestError("Please provide either an email or a phone number");
    }
    // Validate email format if email provided
    if (email && !validateEmail(email)) {
        throw new BadRequestError("Invalid email format.");
    }
    // Validate phone format if phone provided
    if (phone_number && !validatePhone(phone_number)) {
        throw new BadRequestError("Invalid phone number");
    }
    if (code && !/^\d{6}$/.test(code)) {
        throw new BadRequestError("Code must be a 6-digit number");
    }
    if (!new_password) {
        throw new BadRequestError("New password is required");
    }
    if (!device_id) throw new BadRequestError("Device ID is required");
    if (!ip_address) throw new BadRequestError("IP Address is required");
    const input = (email || phone_number)?.trim();
    const passwordValidation = validatePassword(new_password);
    if (!passwordValidation.isValid) {
        throw new BadRequestError(passwordValidation.message);
    }
    // Get client configuration
    const clientConfig = CLIENTS[device]?.[role];
    if (!clientConfig) {
        throw new BadRequestError('Invalid device or role configuration');
    }
    // Determine username and attribute
    const userInfo = getUsernameAndAttribute(input);
    if (!userInfo) {
        throw new BadRequestError('Invalid email or phone format');
    }
    try {
        // Verify user exists and is verified
        const userExists = await checkCognitoUserExists(input, role, device);
        if (!userExists?.exists) {
            throw new NotFoundError('User not found');
        }
        const username = userExists.user.username;
        // Build Cognito params
        const params = {
            ClientId: clientConfig.CLIENT_ID,
            Username: username,
            SecretHash: generateSecretHash(username, clientConfig),
            ConfirmationCode: code,
            Password: new_password,
        };
        // Execute password reset
        console.log(`Resetting password for user: ${username} using IP Address: ${ip_address} and Device ID: ${device_id}`);
        await cognito.confirmForgotPassword(params).promise();
    } catch (error) {
        console.error('Password reset error:', error);
        throw new Error('Failed to reset password');
    }
};

const checkSessionStatus = async (user, role, device, device_id, ip_address) => {
    const allowedDevices = ['browser', 'mobile'];
    if (!device || !allowedDevices.includes(device)) {
        throw new BadRequestError("Invalid or missing device type. Allowed types: 'browser', 'mobile'");
    }
    const userDetails = await User.findOne({ where: { id: user.username } });
    if (!userDetails) {
        throw new BadRequestError("User not found");
    }
    const clientConfig = CLIENTS[device]?.[role];
    if (!clientConfig) {
        throw new BadRequestError('Invalid device or role configuration');
    }
    console.log(`Checking session status for user: ${userDetails.id} using IP Address: ${ip_address} and Device ID: ${device_id}`);
    const session = await Session.findOne({
        where: { user_id: userDetails.id, is_active: true }
    });
    if (!session) {
        throw new BadRequestError("No active sessions found");
    }
    return {
        username: userDetails.id,
        session_id: session.session_id,
        is_active: session.is_active,
        user_agent: session.user_agent,
        ip_address: session.ip_address,
        device_id: session.device_id,
        device_type: `${session['user-agent']}`,
        expires_at: session.expires_at
    };
};

const logout = async (user, user_id, role, device, device_id, ip_address) => {
    if (!user || !user_id) {
        throw new BadRequestError("Please provide valid user auth token");
    };
    if (!role) {
        throw new BadRequestError("Role is required");
    }
    if (!device || !['browser', 'mobile'].includes(device)) {
        throw new BadRequestError("Invalid device type. Allowed types: 'browser', 'mobile'");
    }
    if (!device_id) {
        throw new BadRequestError("Device ID is required");
    }
    if (!ip_address) {
        throw new BadRequestError("IP Address is required");
    }
    const params = { AccessToken: user };
    try {
        await cognito.globalSignOut(params).promise();
        const logoutSession = await Session.update(
            { is_active: false },
            {
                where: {
                    user_id: user_id,
                    "user-agent": device,
                    ip_address: ip_address,
                    device_id: device_id
                }
            }
        );
        if (logoutSession[0] === 0) {
            throw new NotFoundError("No active session found for the user");
        }
    } catch (error) {
        if (error.code === 'NotAuthorizedException') {
            throw new BadRequestError('Session already expired');
        }
        throw new InternalServerError('Something went wrong');
    }
};

const resetSession = async (username, email, phone, password, role, device, device_id, ip_address) => {
    // Validate device type
    try {
        if (!['browser', 'mobile'].includes(device)) {
            throw new BadRequestError("Invalid device type.");
        }
        // Validate presence of at least one login identifier
        if (!username && !email && !phone) {
            throw new BadRequestError("Please provide either username, email, or phone for login.");
        }
        if (!password) {
            throw new BadRequestError("Password is required to login");
        }
        if (!role) {
            throw new BadRequestError("Role is missing");
        }
        if (!device_id) {
            throw new BadRequestError("Device ID is missing");
        }
        if (!ip_address) {
            throw new BadRequestError("IP Address is missing");
        }
        const input = username || email || phone;
        if (!input) throw new BadRequestError("Username, email or phone is required");
        // Validate input identifier type
        const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
        const isPhone = /^\+?[1-9]\d{1,14}$/.test(input); // E.164 format
        const isUsername = /^[a-zA-Z0-9]{8}$/.test(input);
        // Validate email if provided
        if (email && !validateEmail(email)) {
            throw new BadRequestError("Invalid email format.");
        }
        // Validate username if provided
        const usernameRegex = /^[a-zA-Z0-9]{8}$/;
        if (username && !usernameRegex.test(username)) {
            throw new BadRequestError("Username must be exactly 8 alphanumeric characters");
        }
        // Validate phone if provided
        if (phone && !validatePhone(phone)) {
            throw new BadRequestError("Invalid Phone number format");
        }
        let identifierType, identifierValue;
        if (isEmail) {
            identifierType = "email";
            identifierValue = input;
        } else if (isPhone) {
            identifierType = "phone_number";
            identifierValue = input;
        } else if (isUsername) {
            identifierType = "username";
            identifierValue = input;
        } else {
            throw new BadRequestError("Invalid identifier format");
        }
        // Get client configuration
        const clientConfig = CLIENTS[device]?.[role];
        if (!clientConfig) throw new BadRequestError("Invalid device or role");
        // Check user existence
        const userExists = await checkCognitoUserExists(identifierValue, role, device);
        if (!userExists?.exists) throw new NotFoundError("User not found");
        const user = userExists.user;
        const { attributes } = user;
        await confirmUser(userExists.user.username, role, device);
        // Handle unverified attributes
        if (identifierType === "email" && attributes.email_verified !== "true") {
            await sendOTP(email, null, device, role, device_id, ip_address);
            throw new VerificationError("Email not verified. Verification code sent.", "email");
        }
        if (identifierType === "phone_number" && attributes.phone_number_verified !== "true") {
            await sendOTP(null, phone, device, role, device_id, ip_address);
            throw new VerificationError("Phone number not verified. Verification code sent.", "phone_number");
        }
        // logout previous session if exists
        const existingSession = await Session.findOne({
            where: {
                user_id: user.username,
                is_active: true
            }
        });
        if (existingSession) {
            const preLogin = await cognito.initiateAuth({
                AuthFlow: "USER_PASSWORD_AUTH",
                ClientId: clientConfig.CLIENT_ID,
                AuthParameters: {
                    USERNAME: user.username,
                    PASSWORD: password,
                    SECRET_HASH: generateSecretHash(user.username, clientConfig),
                }
            }).promise();
            if (!preLogin.AuthenticationResult) {
                throw new BadRequestError("Authentication failed. Please check your credentials.");
            }
            await cognito.adminUserGlobalSignOut({
                UserPoolId: clientConfig.USER_POOL_ID,
                Username: user.username
            }).promise();
            await Session.update(
                { is_active: false },
                { where: { user_id: user.username } }
            );
            console.log(`Previous session for user ${user.username} has been logged out.`);
        }
        // Authenticate with Cognito
        const authResponse = await cognito.initiateAuth({
            AuthFlow: "USER_PASSWORD_AUTH",
            ClientId: clientConfig.CLIENT_ID,
            AuthParameters: {
                USERNAME: user.username,
                PASSWORD: password,
                SECRET_HASH: generateSecretHash(user.username, clientConfig),
            }
        }).promise();
        if (!authResponse.AuthenticationResult || !authResponse.AuthenticationResult.AccessToken) {
            throw new BadRequestError("Authentication failed. Please check your credentials.");
        }
        // Generate tokens
        const tokens = authResponse.AuthenticationResult;
        // Create new session
        const refreshExpiry = device === "browser"
            ? parseInt(process.env.BROWSER_REFRESH_EXPIRY || "3600")
            : parseInt(process.env.MOBILE_REFRESH_EXPIRY || "2592000");
        await Session.create({
            "session_id": uuidv4(),
            "user_id": user.username,
            "user-agent": device,
            "device_id": device_id,
            "ip_address": ip_address,
            "refresh_token": tokens.RefreshToken,
            "created_at": new Date(),
            "expires_at": new Date(Date.now() + refreshExpiry * 1000),
            "is_active": true
        });
        return {
            username: user.username,
            access_token: tokens.AccessToken,
            id_token: tokens.IdToken,
            expires_in: tokens.ExpiresIn,
            refresh_token: tokens.RefreshToken,
            refresh_expires_in: refreshExpiry,
            device: device,
        };
    } catch (error) {
        console.error('SignIn Error:', error);
        if (error instanceof AppError) {
            throw error;
        }
        throw new InternalServerError('Incorrect Password');
    }
};

const generateTokens = async (refreshToken, username, role, device, device_id, ip_address) => {
    if (!device_id) {
        throw new BadRequestError("Device ID is required");
    };
    if (!ip_address) {
        throw new BadRequestError("IP Address is required");
    };
    if (!refreshToken) {
        throw new BadRequestError("Refresh token is required");
    };
    if (!username) {
        throw new BadRequestError("Username is required");
    };
    if (!role) {
        throw new BadRequestError("Role is required");
    };
    try {
        const clientConfig = CLIENTS[device]?.[role];
        if (!['browser', 'mobile'].includes(device)) {
            throw new BadRequestError("Device must be either 'browser' or 'mobile'");
        };
        if (!clientConfig) throw new BadRequestError("Invalid device or role");
        new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });
        const params = {
            AuthFlow: 'REFRESH_TOKEN_AUTH',
            ClientId: clientConfig.CLIENT_ID,
            AuthParameters: {
                REFRESH_TOKEN: refreshToken,
                SECRET_HASH: generateSecretHash(username, clientConfig),
                USERNAME: username
            }
        };
        console.log("SecretHash Generated:", generateSecretHash(username, clientConfig));
        const response = await cognito.initiateAuth(params).promise();
        if (!response.AuthenticationResult || !response.AuthenticationResult.AccessToken) {
            throw new BadRequestError("Failed to refresh tokens");
        };
        return {
            access_token: response.AuthenticationResult.AccessToken,
            id_token: response.AuthenticationResult.IdToken,
            refresh_token: response.AuthenticationResult.RefreshToken || refreshToken,
            expires_in: response.AuthenticationResult.ExpiresIn,
            token_type: response.AuthenticationResult.TokenType,
        };
    } catch (error) {
        console.error("Error generating tokens:", error);
        throw new InternalServerError("Refresh token expired! Please login again.");
    }
}

module.exports = {
    signupUser,
    confirmSignup,
    signIn,
    sendOTP,
    verifyOTP,
    getUser,
    sendForgotPasswordOTP,
    confirmForgotPassword,
    checkSessionStatus,
    logout,
    resetSession,
    generateTokens,
};
