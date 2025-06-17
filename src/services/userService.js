const {
    CognitoIdentityProviderClient,
    InitiateAuthCommand,
    RespondToAuthChallengeCommand,
    AdminConfirmSignUpCommand,
    AdminGetUserCommand,
    AdminUpdateUserAttributesCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const { cognito, CLIENTS, s3 } = require("../config/cognito");
const { generateSecretHash } = require("../utils/secretHash");
const { v4: uuidv4 } = require("uuid");
const db = require('../db/sequelize.db');
const { User, Session } = db;
const { createLogger } = require('../utils/awsLogger');
const logger = createLogger('userService');
const {
    AppError,
    BadRequestError,
    NotFoundError,
    ConflictError,
    InternalServerError,
    VerificationError,
    SessionError
} = require('../utils/errorHandler');

const checkCognitoUserExists = async (identifier, role, device) => {
    try {
        const clientConfig = CLIENTS[device]?.[role];
        if (!clientConfig) {
            logger.warn('Invalid client configuration');
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
            logger.warn('Invalid identifier format', { identifier });
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
        if (!matchedUser) {
            logger.info('No matching user found in Cognito');
            return false;
        }
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
        logger.info('User found in Cognito', { username: userDetails.username });
        return {
            exists: true,
            user: userDetails
        };
    } catch (err) {
        logger.error({
            message: err.message || 'Failed to check if user exists in Cognito',
            code: err.code,
            stack: err.stack,
        });
        throw new BadRequestError("Failed to check if user exists in Cognito");
    }
};

async function confirmUser(username, role, device) {
    const clientConfig = CLIENTS[device]?.[role];
    if (!clientConfig) {
        logger.warn('Invalid device or role', { username });
        throw new BadRequestError("Invalid device or role");
    }
    const client = new CognitoIdentityProviderClient({ region: process.env.AWS_REG });
    const getUserCommand = new AdminGetUserCommand({
        Username: username,
        UserPoolId: clientConfig.USER_POOL_ID,
    });
    try {
        const userData = await client.send(getUserCommand);
        if (userData.UserStatus === "CONFIRMED") {
            logger.info('User already confirmed', { username });
            return;
        }
        //Confirm user if needed
        const confirmCommand = new AdminConfirmSignUpCommand({
            Username: username,
            UserPoolId: clientConfig.USER_POOL_ID,
        });
        await client.send(confirmCommand);
        logger.info('User confirmed successfully', { username });
    } catch (err) {
        logger.error({
            message: err.message || 'Failed to confirm user',
            code: err.code,
            stack: err.stack
        });
        throw new BadRequestError("Failed to confirm user");
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
        const cognitoClient = new CognitoIdentityProviderClient({ region: process.env.AWS_REG });
        const clientConfig = CLIENTS[device]?.[role];
        if (!clientConfig) {
            logger.warn('Invalid device or role', { username });
            throw new BadRequestError('Invalid device or role');
        }
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
            logger.info('Attribute already verified', { username, attribute: loginAttribute });
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
        logger.info('Attribute marked as verified', { username, attribute: loginAttribute });
    } catch (error) {
        logger.error({
            error: error.message || `Failed to verify ${loginAttribute}`,
            code: error.code,
            stack: error.stack
        });
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

const signupUser = async ({ email, phone_number, password, role, device, first_name, last_name, device_id, ip_address }) => {
    try {
        // Basic Field Validations
        logger.appendKeys({ device, role, device_id, ip_address });
        logger.info("Starting signup process");
        if (!first_name) throw new BadRequestError("First name is required");
        if (!last_name) throw new BadRequestError("Last name is required");
        if (!email) throw new BadRequestError("Email is required");
        if (!phone_number) throw new BadRequestError("Phone number is required");
        if (!password) throw new BadRequestError("Password is required");
        if (!role) throw new BadRequestError("Role is required");
        if (!device) throw new BadRequestError("Device is required");
        if (!device_id) throw new BadRequestError("Device ID is required");
        if (!ip_address) throw new BadRequestError("IP Address is required");
        if (!['browser', 'mobile'].includes(device)) {
            throw new BadRequestError("Device must be either 'browser' or 'mobile'");
        }
        logger.info("Passed field validations");
        // Email Format Validation
        if (!validateEmail(email)) {
            logger.warn("Invalid email format", { email });
            throw new BadRequestError("Invalid email format");
        }
        // Phone Format Validation
        if (!validatePhone(phone_number)) {
            logger.warn("Invalid phone number format", { phone_number });
            throw new BadRequestError("Invalid phone number format");
        }
        // Password Strength Validation
        const passwordCheck = validatePassword(password);
        if (!passwordCheck.isValid) {
            logger.warn("Password validation failed", { reason: passwordCheck.message });
            throw new BadRequestError(passwordCheck.message);
        }
        // Checking if user already exists in Cognito
        const emailCheck = email ? await checkCognitoUserExists(email, role, device) : { exists: false };
        const phoneCheck = phone_number ? await checkCognitoUserExists(phone_number, role, device) : { exists: false };
        if (emailCheck.exists && phoneCheck.exists) {
            logger.warn("User already exists with both email and phone");
            throw new ConflictError("User already exists");
        } else if (emailCheck.exists) {
            logger.warn("Email already exists", { email });
            throw new ConflictError("Email already exists");
        } else if (phoneCheck.exists) {
            logger.warn("Phone number already exists", { phone_number });
            throw new ConflictError("Phone number already exists");
        }
        // Generate 8-char UUID username
        const generateUUID = () => uuidv4().replace(/-/g, "").slice(0, 8);
        const username = generateUUID();
        logger.info("Generated username", { username });
        // User attributes
        const userAttributes = [];
        if (email) userAttributes.push({ Name: "email", Value: email });
        if (phone_number) userAttributes.push({ Name: "phone_number", Value: phone_number });
        if (role) userAttributes.push({ Name: "custom:role", Value: role });
        const clientConfig = CLIENTS[device]?.[role];
        if (!clientConfig) {
            logger.warn("Invalid device configuration");
            throw new BadRequestError("Invalid device configuration");
        };
        const params = {
            ClientId: clientConfig.CLIENT_ID,
            Username: username,
            Password: password,
            SecretHash: generateSecretHash(username, clientConfig),
            UserAttributes: userAttributes,
        };
        logger.info("Signing up user with Cognito", { username });
        const response = await cognito.signUp(params).promise();
        // Storing user in DB
        await User.create({
            id: username,
            cognito_sub: response.UserSub,
            email,
            phone: phone_number,
            first_name,
            last_name,
            role,
        });
        logger.info("User saved to DB successfully", { username });
        return {
            username: username,
            emailVerified: false,
            phoneVerified: false,
        };
    } catch (error) {
        logger.error({
            message: error.message || "Signup failed due to an unexpected error",
            stack: error.stack,
        });
        if (error instanceof AppError) {
            throw error;
        }
        throw new InternalServerError("Signup failed due to an unexpected error");
    }
};

const confirmSignup = async ({ phone_number, email, role, signup_code, password, device, email_code, phone_code, device_id, ip_address, logoutPreviousSession = false }) => {
    logger.appendKeys({ device, role, device_id, ip_address });
    logger.info("Starting confirmSignup process");
    if (!role) {
        throw new BadRequestError("Role is required");
    }
    if (!device) {
        throw new BadRequestError("Device is required");
    }
    if (!['browser', 'mobile'].includes(device)) {
        throw new BadRequestError("Device must be either 'browser' or 'mobile'");
    }
    if (!phone_number && !email) {
        throw new BadRequestError("Phone or Email is required");
    }
    if (email) {
        if (!validateEmail(email)) {
            throw new BadRequestError("Invalid email format");
        }
    }
    if (phone_number) {
        if (!validatePhone(phone_number)) {
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
    const identifier = phone_number || email;
    if (!identifier) throw new BadRequestError("Email or phone is required");
    const clientConfig = CLIENTS[device]?.[role];
    if (!clientConfig) throw new BadRequestError("Invalid device");
    logger.info("Validations passed, checking if user exists in Cognito");
    const existsInCognito = await checkCognitoUserExists(identifier, role, device);
    if (!existsInCognito.exists) {
        logger.error("User not found in Cognito");
        throw new NotFoundError("User not found");
    }
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
                logger.info("Sending email verification code");
                await cognito.getUserAttributeVerificationCode({
                    AccessToken: accessToken,
                    AttributeName: 'email',
                }).promise();
            } catch (err) {
                logger.error({
                    message: err.message || 'Failed to send email verification code',
                    username,
                    code: err.code || 'UnknownError',
                    stack: err.stack || 'No stack trace available'
                });
                throw new BadRequestError("Failed to send email verification code");
            }
        }
        if (attrs.phone_number && attrs.phone_number_verified !== 'true') {
            try {
                logger.info("Sending phone verification code");
                await cognito.getUserAttributeVerificationCode({
                    AccessToken: accessToken,
                    AttributeName: 'phone_number',
                }).promise();
            } catch (err) {
                logger.error({
                    message: err.message || 'Failed to send email verification code',
                    username,
                    code: err.code || 'UnknownError',
                    stack: err.stack || 'No stack trace available',
                });
                throw new BadRequestError("Failed to send phone verification code");
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
            logger.info("All verifications completed. Proceeding to token generation");
            return await generateAndSendTokens(username, device, refreshToken, logoutPreviousSession);
        }
        //Need verification
        logger.warn("Verification pending for email or phone");
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
        logger.info("Checking existing active session");
        const existingSession = await Session.findOne({
            where: {
                user_id: username,
                is_active: true
            }
        });
        if (existingSession) {
            if (!logoutPreviousSession) {
                logger.warn("Active session found, prompting logout confirmation");
                throw new SessionError("An active session exists. Please confirm to logout from the previous device");
            }
        }
        // Create new session
        logger.info("Creating new session");
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
        logger.info("Session created and tokens issued", { username });
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
            logger.info("Attempting signup confirmation using code");
            await cognito.confirmSignUp({
                ClientId: clientConfig.CLIENT_ID,
                Username: username,
                ConfirmationCode: signup_code,
                SecretHash: secretHash,
            }).promise();
            logger.info("Signup confirmed, activating user");
            await User.update({ is_active: true }, { where: { id: existsInCognito.user.username } });
            logger.info(`User ${username} marked as active in DB`);
        } catch (err) {
            logger.error({
                message: err.message || 'Signup confirmation failed',
                username,
                code: err.code || 'UnknownError',
                stack: err.stack || 'No stack trace available'
            });
            throw new BadRequestError("Signup confirmation failed");
        }
        // Authenticate after confirmation
        try {
            logger.info("Authenticating user after confirmation");
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
            logger.error({
                message: err.message || 'Authentication failed',
                code: err.code || 'UnknownError',
                stack: err.stack || 'No stack trace available'
            });
            throw new BadRequestError("Authentication failed. Please try again later.");
        }
        // Get user attributes
        const { attributes } = await getUserVerificationStatus(accessToken);
        await sendVerificationCodesIfNeeded(accessToken, attributes);
        // Check verification status and send tokens
        return await sendTokensIfFullyVerified(username, device, refreshToken, logoutPreviousSession);
    }
    if (email_code || phone_code) {
        try {
            logger.info("Authenticating user for verification");
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
            logger.error({
                message: err.message || 'Authentication failed',
                username,
                code: err.code || 'UnknownError',
                stack: err.stack || 'No stack trace available'
            });
            throw new BadRequestError(`Authentication failed: ${err.message}`);
        }
        // Verify email code if provided
        if (email_code) {
            try {
                logger.info("Verifying email");
                await cognito.verifyUserAttribute({
                    AccessToken: accessToken,
                    AttributeName: 'email',
                    Code: email_code,
                }).promise();
            } catch (err) {
                logger.error({
                    message: err.message || 'Email verification failed',
                    username,
                    code: err.code || 'UnknownError',
                    stack: err.stack || 'No stack trace available'
                });
                throw new BadRequestError(`Email verification failed: ${err.message}`);
            }
        }
        // Verify phone code if provided
        if (phone_code) {
            try {
                logger.info("Verifying phone");
                await cognito.verifyUserAttribute({
                    AccessToken: accessToken,
                    AttributeName: 'phone_number',
                    Code: phone_code,
                }).promise();
            } catch (err) {
                logger.error({
                    message: err.message || 'Phone verification failed',
                    username,
                    code: err.code || 'UnknownError',
                    stack: err.stack || 'No stack trace available'
                });
                throw new BadRequestError(`Phone verification failed: ${err.message}`);
            }
        }
        return await sendTokensIfFullyVerified(username, device, refreshToken, logoutPreviousSession);
    }
};

const signIn = async ({ username, email, phone_number, password, role, device, device_id, ip_address, logoutPreviousSession = false }) => {
    try {
        logger.appendKeys({ device, role, device_id, ip_address });
        logger.info("Starting signIn process");
        // Validate device type
        if (!['browser', 'mobile'].includes(device)) {
            throw new BadRequestError("Invalid device type.");
        }
        // Validate presence of at least one login identifier
        if (!username && !email && !phone_number) {
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
        const input = username || email || phone_number;
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
        if (phone_number && !validatePhone(phone_number)) {
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
        logger.info('All validations passed, proceeding with sign-in');
        // Check user existence
        logger.info(`Checking if user exists with ${identifierType}`);
        const userExists = await checkCognitoUserExists(identifierValue, role, device);
        if (!userExists?.exists) throw new NotFoundError("User not found");
        const user = userExists.user;
        const { attributes } = user;
        logger.info(`User ${user.username} found, confirming in Cognito`);
        await confirmUser(userExists.user.username, role, device);
        // Handle unverified attributes
        if (identifierType === "email" && attributes.email_verified !== "true") {
            logger.warn("Email not verified. Sending verification code.");
            const otpResponse = await sendOTP(email, null, device, role, device_id, ip_address);
            throw new VerificationError("Email not verified. Verification code sent.", "email", otpResponse.session);
        }
        if (identifierType === "phone_number" && attributes.phone_number_verified !== "true") {
            logger.warn("Phone not verified. Sending verification code.");
            const otpResponse = await sendOTP(null, phone_number, device, role, device_id, ip_address);
            throw new VerificationError("Phone number not verified. Verification code sent.", "phone_number", otpResponse.session);
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
        logger.info("Attempting Cognito authentication");
        const tokens = authResponse.AuthenticationResult;
        logger.info(`User ${user.username} authenticated successfully`);
        // Check for existing active sessions
        const existingSession = await Session.findOne({
            where: {
                user_id: user.username,
                is_active: true
            }
        });
        if (existingSession) {
            if (!logoutPreviousSession) {
                logger.warn("Active session found. User needs to logout previous session.");
                throw new SessionError("An active session exists on another device. Confirm to logout from that device.");
            };
        }
        // Create new session
        const refreshExpiry = device === "browser"
            ? parseInt(process.env.BROWSER_REFRESH_EXPIRY || "3600")
            : parseInt(process.env.MOBILE_REFRESH_EXPIRY || "2592000");
        logger.info("Creating new session for user");
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
        logger.info(`Session created and tokens issued for ${user.username}`);
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
        logger.error({
            message: error.message || 'Incorrect Password',
            code: error.code || 'UnknownError',
            stack: error.stack || 'No stack trace'
        });
        if (error instanceof AppError) {
            throw error;
        }
        throw new InternalServerError('Incorrect Password');
    }
};

const sendOTP = async (email, phone_number, device, role, device_id, ip_address) => {
    logger.appendKeys({ device, role, device_id, ip_address });
    logger.info("Starting OTP initiation");
    const allowedDevices = ['browser', 'mobile'];
    if (!device || !allowedDevices.includes(device)) {
        throw new BadRequestError("Invalid or missing device type. Allowed types: 'browser', 'mobile'");
    }
    // Validate role
    if (!role) {
        throw new BadRequestError("Role is required.");
    }
    // Validate at least email or phone is provided
    if (!email && !phone_number) {
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
    const clientConfig = CLIENTS[device]?.[role];
    if (!clientConfig) throw new BadRequestError("Invalid device configuration");
    const input = (email || phone_number).trim();
    const userInfo = getUsernameAndAttribute(input);
    if (!userInfo) throw new BadRequestError('Invalid email or phone format');
    logger.info("Validations passed, checking if user exists in Cognito");
    const userExists = await checkCognitoUserExists(input, role, device);
    if (!userExists?.exists) {
        logger.warn("User not found for OTP request");
        throw new NotFoundError("User not found");
    }
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
            region: process.env.AWS_REG
        });
        logger.info(`Initiating OTP for user: ${username}`);
        const sendOTP = new InitiateAuthCommand(params);
        const response = await cognitoClient.send(sendOTP);
        if (!response.Session) {
            logger.error("No session returned from Cognito during OTP initiation", { username });
            throw new BadRequestError("No session returned from Cognito");
        }
        logger.info(`OTP initiation successful for user: ${username}`);
        return {
            session: response.Session,
        };
    } catch (error) {
        logger.error({
            message: error.message || 'Failed to initiate OTP process',
            code: error.code || 'UnknownError',
            stack: error.stack || 'No stack trace available',
        });
        if (error instanceof AppError) {
            throw error;
        }
        throw new BadRequestError('Failed to initiate OTP process');
    }
};

const verifyOTP = async (email, phone_number, otp, role, device, session, device_id, ip_address, logoutPreviousSession = false) => {
    logger.appendKeys({ device, role, device_id, ip_address });
    logger.info("Starting OTP verification");
    const allowedDevices = ['browser', 'mobile'];
    if (!device || !allowedDevices.includes(device)) {
        throw new BadRequestError("Invalid or missing device type. Allowed types: 'browser', 'mobile'");
    }
    // Validate role
    if (!role) {
        throw new BadRequestError("Role is required.");
    }
    // Validate at least email or phone is provided
    if (!email && !phone_number) {
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
    const input = (email || phone_number).trim();
    const userInfo = getUsernameAndAttribute(input);
    if (!userInfo) throw new BadRequestError('Invalid email or phone format');
    logger.info("Validations passed, checking if user exists in Cognito");
    const userExists = await checkCognitoUserExists(input, role, device);
    if (!userExists?.exists) {
        logger.warn("User not found for OTP verification");
        throw new NotFoundError("User not found");
    }
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
        const cognitoClient = new CognitoIdentityProviderClient({ region: process.env.AWS_REG });
        // Respond to the auth challenge
        logger.info(`Verifying OTP for user: ${username}`);
        const response = await cognitoClient.send(new RespondToAuthChallengeCommand(params));
        if (!response.AuthenticationResult && !response.Session) {
            logger.error("Unexpected response from Cognito during OTP verification", { username });
            throw new BadRequestError('Unexpected response');
        }
        if (!userExists["verified"]?.[attribute]) {
            logger.info(`Marking ${loginAttribute} as verified for user ${username}`);
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
                logger.warn("Active session exists. Rejecting new session until old session is logged out.");
                throw new SessionError("An active session exists on another device. Confirm to logout from that device.");
            }
        }
        // Create new session
        const refreshExpiry = device === "browser"
            ? parseInt(process.env.REFRESH_EXPIRY_BROWSER || "3600")
            : parseInt(process.env.REFRESH_EXPIRY_MOBILE || "2592000");
        logger.info("Creating new session after OTP verification");
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
        logger.info(`OTP verification and session creation successful for ${username}`);
        return {
            username: username,
            access_token: tokens.AccessToken,
            id_token: tokens.IdToken,
            expires_in: tokens.ExpiresIn,
            refresh_token: tokens.RefreshToken,
            refresh_expires_in: refreshExpiry,
        };
    } catch (error) {
        logger.error({
            message: error.message || 'OTP verification failed',
            code: error.code || 'UnknownError',
            stack: error.stack || 'No stack trace available',
        });
        if (error instanceof AppError) {
            throw error;
        }
        throw new BadRequestError('OTP verification failed');
    }
};

const getUser = async (userDetails, role, device, device_id, ip_address) => {
    logger.appendKeys({ role, device, device_id, ip_address });
    logger.info("Starting getUser function");
    const client = new CognitoIdentityProviderClient({ region: process.env.AWS_REG });
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
    logger.info('Fetching user from database');
    const user = await db.User.findOne({
        where: { id: userDetails.username }
    });
    if (!user) {
        logger.error('User not found in DB');
        throw new BadRequestError('User not found');
    }
    // Fetch verification status from Cognito
    let email_verified = "false";
    let phone_number_verified = "false";
    const command = new AdminGetUserCommand({
        UserPoolId: process.env.COGNITO_USER_POOL_ID,
        Username: userDetails.username,
    });
    logger.info("Fetching user attributes from Cognito");
    const cognitoUser = await client.send(command);
    for (const attr of cognitoUser.UserAttributes) {
        if (attr.Name === "email_verified") email_verified = attr.Value;
        if (attr.Name === "phone_number_verified") phone_number_verified = attr.Value;
    }
    logger.info("User attributes fetched from Cognito", {
        email_verified,
        phone_number_verified
    });
    logger.info(`User details fetched successfully for ${user.id}`);
    return {
        username: user.id,
        email: user.email,
        phone_number: user.phone,
        first_name: user.first_name,
        last_name: user.last_name,
        profile_pic: user.profile_pic_url,
        role: user.role,
        email_verified,
        phone_number_verified,
    };
};

const sendForgotPasswordOTP = async ({ email, phone_number, role, device, device_id, ip_address }) => {
    logger.appendKeys({ role, device, device_id, ip_address });
    logger.info("Starting forgot password OTP flow");
    const allowedDevices = ['browser', 'mobile'];
    if (!device || !allowedDevices.includes(device)) {
        logger.error("Invalid device type provided");
        throw new BadRequestError("Invalid or missing device type. Allowed types: 'browser', 'mobile'");
    }
    if (!role) {
        logger.error("Role is missing");
        throw new BadRequestError("Role is required.");
    }
    if (!email && !phone_number) {
        logger.error("Neither email nor phone number provided");
        throw new BadRequestError("Please provide either an email or a phone number.");
    }
    if (email && !validateEmail(email)) {
        logger.error("Invalid email format provided");
        throw new BadRequestError("Invalid email format.");
    }
    if (phone_number && !validatePhone(phone_number)) {
        logger.error("Invalid phone number format provided");
        throw new BadRequestError("Invalid phone number format");
    }
    if (!device_id) throw new BadRequestError("Device ID is required");
    if (!ip_address) throw new BadRequestError("IP Address is required");
    const clientConfig = CLIENTS[device]?.[role];
    if (!clientConfig) throw new BadRequestError("Invalid device or role configuration");
    const input = (email || phone_number)?.trim();
    if (!input) throw new BadRequestError('Email or phone number is required');
    const userInfo = getUsernameAndAttribute(input);
    if (!userInfo) throw new BadRequestError('Invalid email or phone format');
    logger.info(`Checking if user exists in Cognito: ${input}`);
    const userExists = await checkCognitoUserExists(input, role, device);
    if (!userExists?.exists) {
        logger.warn("User not found in Cognito", { input });
        throw new NotFoundError("User not found");
    }
    const username = userInfo.username;
    const isVerified = userInfo.loginAttribute === 'email'
        ? userExists.user.attributes.email_verified === 'true'
        : userExists.user.attributes.phone_number_verified === 'true';
    if (!isVerified) {
        logger.warn(`${userInfo.loginAttribute} is not verified for ${username}`);
        throw new BadRequestError(
            userInfo.loginAttribute === 'email'
                ? 'Email is not verified'
                : 'Phone number is not verified'
        );
    }
    let temporarilyDisabledEmail = false;
    try {
        if (
            userInfo.loginAttribute === 'phone_number' &&
            userExists.user.attributes.email_verified === 'true' &&
            userExists.user.attributes.phone_number_verified === 'true'
        ) {
            logger.info("Temporarily disabling email_verified to force OTP to phone");
            await cognito.adminUpdateUserAttributes({
                UserPoolId: clientConfig.USER_POOL_ID,
                Username: username,
                UserAttributes: [
                    { Name: 'email_verified', Value: 'false' }
                ]
            }).promise();
            temporarilyDisabledEmail = true;
        }
        logger.info(`Sending forgot password OTP to user: ${username}`);
        const cognitoResponse = await cognito.forgotPassword({
            ClientId: clientConfig.CLIENT_ID,
            Username: username,
            SecretHash: generateSecretHash(username, clientConfig),
        }).promise();
        logger.info(`Forgot password OTP sent successfully to ${userInfo.loginAttribute}: ${username}`);
        return {
            deliveryMedium: cognitoResponse.CodeDeliveryDetails?.DeliveryMedium || '',
            destination: cognitoResponse.CodeDeliveryDetails?.Destination || ''
        };
    } catch (error) {
        if (error.code === 'LimitExceededException') {
            throw new BadRequestError('Too many attempts. Please try again later.');
        }
        logger.error({
            message: error.message || 'Failed to send password reset OTP',
            code: error.code || 'UnknownError',
            stack: error.stack || 'No stack trace available',
        });
        if (error instanceof AppError) {
            throw error;
        }
        throw new InternalServerError('Failed to send password reset OTP');
    } finally {
        if (temporarilyDisabledEmail) {
            logger.info("Restoring email_verified back to true");
            await cognito.adminUpdateUserAttributes({
                UserPoolId: clientConfig.USER_POOL_ID,
                Username: username,
                UserAttributes: [
                    { Name: 'email_verified', Value: 'true' }
                ]
            }).promise();
        }
    }
};

const confirmForgotPassword = async ({ email, phone_number, code, new_password, role, device, device_id, ip_address }) => {
    logger.appendKeys({ role, device, device_id, ip_address });
    logger.info("Starting forgot password OTP flow");
    const allowedDevices = ['browser', 'mobile'];
    // Validate device
    if (!device || !allowedDevices.includes(device)) {
        logger.error("Invalid device type provided");
        throw new BadRequestError("Invalid or missing device type. Allowed types: 'browser', 'mobile'");
    }
    // Validate role
    if (!role) {
        logger.error("Role is missing");
        throw new BadRequestError("Role is required.");
    }
    // Validate at least email or phone is provided
    if (!email && !phone_number) {
        logger.error("Neither email nor phone number provided");
        throw new BadRequestError("Please provide either an email or a phone number");
    }
    // Validate email format if email provided
    if (email && !validateEmail(email)) {
        logger.error("Invalid email format provided");
        throw new BadRequestError("Invalid email format.");
    }
    // Validate phone format if phone provided
    if (phone_number && !validatePhone(phone_number)) {
        logger.error("Invalid phone number format provided");
        throw new BadRequestError("Invalid phone number");
    }
    if (code && !/^\d{6}$/.test(code)) {
        logger.error("Invalid code format provided");
        throw new BadRequestError("Code must be a 6-digit number");
    }
    if (!new_password) {
        logger.error("New password is required but not provided");
        throw new BadRequestError("New password is required");
    }
    if (!device_id) throw new BadRequestError("Device ID is required");
    if (!ip_address) throw new BadRequestError("IP Address is required");
    const input = (email || phone_number)?.trim();
    const passwordValidation = validatePassword(new_password);
    if (!passwordValidation.isValid) {
        logger.error("Password validation failed", { message: passwordValidation.message });
        throw new BadRequestError(passwordValidation.message);
    }
    // Get client configuration
    const clientConfig = CLIENTS[device]?.[role];
    if (!clientConfig) {
        logger.error("Invalid device or role configuration");
        throw new BadRequestError('Invalid device or role configuration');
    }
    // Determine username and attribute
    const userInfo = getUsernameAndAttribute(input);
    if (!userInfo) {
        logger.error("Invalid email or phone number format provided");
        throw new BadRequestError('Invalid email or phone number format');
    }
    try {
        // Verify user exists and is verified
        logger.info(`Checking if user exists in Cognito: ${input}`);
        const userExists = await checkCognitoUserExists(input, role, device);
        if (!userExists?.exists) {
            logger.warn("User not found in Cognito", { input });
            throw new NotFoundError('User not found');
        }
        logger.info(`User ${userExists.user.username} found in Cognito, proceeding with password reset`);
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
        logger.info(`Resetting password for user: ${username}`);
        await cognito.confirmForgotPassword(params).promise();
    } catch (error) {
        logger.error({
            message: error.message || 'Please enter correct OTP',
            code: error.code || 'UnknownError',
            stack: error.stack || 'No stack trace available',
        });
        if (error instanceof AppError) {
            throw error;
        }
        throw new BadRequestError('Please enter correct OTP');
    }
};

const checkSessionStatus = async (user, role, device, device_id, ip_address) => {
    logger.appendKeys({ role, device, device_id, ip_address });
    logger.info("Starting session status check");
    const allowedDevices = ['browser', 'mobile'];
    if (!device || !allowedDevices.includes(device)) {
        logger.error("Invalid device type provided");
        throw new BadRequestError("Invalid or missing device type. Allowed types: 'browser', 'mobile'");
    }
    logger.info("Checking user present in DB");
    const userDetails = await User.findOne({ where: { id: user.username } });
    if (!userDetails) {
        logger.error("User not found in database");
        throw new BadRequestError("User not found");
    }
    const clientConfig = CLIENTS[device]?.[role];
    if (!clientConfig) {
        logger.error("Invalid device or role configuration");
        throw new BadRequestError('Invalid device or role configuration');
    }
    logger.info("Fetching active session for user");
    const session = await Session.findOne({
        where: {
            user_id: userDetails.id,
            is_active: true,
            "user-agent": device,
            ip_address: ip_address,
            device_id: device_id
        },
        order: [['created_at', 'DESC']]
    });
    if (!session) {
        logger.warn("No active session found for user", { username: userDetails.id });
        throw new BadRequestError("No active sessions found");
    }
    logger.info("Active session found, returning session details");
    return {
        username: userDetails.id,
        session_id: session.session_id,
        user_agent: `${session['user-agent']}`,
        ip_address: session.ip_address,
        device_id: session.device_id,
    };
};

const logout = async (user, user_id, role, device, device_id, ip_address) => {
    logger.appendKeys({ role, device, device_id, ip_address });
    logger.info("Starting logout process");
    if (!user || !user_id) {
        logger.error("User authentication token is missing");
        throw new BadRequestError("Please provide valid user auth token");
    };
    if (!role) {
        logger.error("Role is missing");
        throw new BadRequestError("Role is required");
    }
    if (!device || !['browser', 'mobile'].includes(device)) {
        logger.error("Invalid device provided");
        throw new BadRequestError("Invalid device type. Allowed types: 'browser', 'mobile'");
    }
    if (!device_id) {
        logger.error("Device ID is missing");
        throw new BadRequestError("Device ID is required");
    }
    if (!ip_address) {
        logger.error("IP Address is missing");
        throw new BadRequestError("IP Address is required");
    }
    const params = { AccessToken: user };
    try {
        logger.info('Logging out user');
        await cognito.globalSignOut(params).promise();
        logger.info(`User ${user_id} logged out successfully from Cognito`);
        // Update session status in the database
        logger.info(`Updating session status for user ${user_id}`);
        const logoutSession = await Session.update(
            { is_active: false },
            {
                where: {
                    user_id: user_id,
                    "user-agent": device,
                    ip_address: ip_address,
                    device_id: device_id,
                    is_active: true
                }
            }
        );
        logger.info(`Session status updated for user ${user_id}`);
        if (logoutSession[0] === 0) {
            logger.warn('No active session found for user');
            throw new NotFoundError("No active session found for the user");
        }
    } catch (error) {
        if (error.code === 'NotAuthorizedException') {
            logger.error('Session already expired, Unable to logout');
            throw new BadRequestError('Session already expired, Unable to logout');
        }
        logger.error({
            message: error.message || 'Something went wrong',
            code: error.code || 'UnknownError',
            stack: error.stack || 'No stack trace available',
        });
        if (error instanceof AppError) {
            throw error;
        }
        throw new InternalServerError('Something went wrong');
    }
};

const resetSession = async (username, email, phone_number, password, role, device, device_id, ip_address) => {
    // Validate device type
    try {
        logger.appendKeys({ role, device, device_id, ip_address });
        logger.info("Starting reset session process");
        if (!['browser', 'mobile'].includes(device)) {
            logger.error("Invalid device type provided");
            throw new BadRequestError("Invalid device type.");
        }
        // Validate presence of at least one login identifier
        if (!username && !email && !phone_number) {
            logger.error("No login identifier provided");
            throw new BadRequestError("Please provide either email or phone number for login.");
        }
        if (!password) {
            logger.error("Password is required but not provided");
            throw new BadRequestError("Password is required to login");
        }
        if (!role) {
            logger.error("Role is missing");
            throw new BadRequestError("Role is missing");
        }
        if (!device_id) {
            logger.error("Device ID is missing");
            throw new BadRequestError("Device ID is missing");
        }
        if (!ip_address) {
            logger.error("IP Address is missing");
            throw new BadRequestError("IP Address is missing");
        }
        const input = username || email || phone_number;
        if (!input) throw new BadRequestError("Username, email or phone number is required");
        // Validate input identifier type
        const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
        const isPhone = /^\+?[1-9]\d{1,14}$/.test(input); // E.164 format
        const isUsername = /^[a-zA-Z0-9]{8}$/.test(input);
        // Validate email if provided
        if (email && !validateEmail(email)) {
            logger.error("Invalid email format provided");
            throw new BadRequestError("Invalid email format.");
        }
        // Validate username if provided
        const usernameRegex = /^[a-zA-Z0-9]{8}$/;
        if (username && !usernameRegex.test(username)) {
            logger.error("Invalid username format provided");
            throw new BadRequestError("Username must be exactly 8 alphanumeric characters");
        }
        // Validate phone if provided
        if (phone_number && !validatePhone(phone_number)) {
            logger.error("Invalid phone number format provided");
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
            logger.error("Invalid identifier format provided");
            throw new BadRequestError("Invalid identifier format");
        }
        // Get client configuration
        const clientConfig = CLIENTS[device]?.[role];
        if (!clientConfig) throw new BadRequestError("Invalid device or role");
        // Check user existence
        logger.info(`Checking if user exists with ${identifierType}`);
        const userExists = await checkCognitoUserExists(identifierValue, role, device);
        if (!userExists?.exists) {
            logger.warn("User not found");
            throw new NotFoundError("User not found");
        }
        const user = userExists.user;
        logger.info(`User ${user.username} found, confirming in Cognito`);
        await confirmUser(userExists.user.username, role, device);
        // logout previous session if exists
        logger.info(`Checking for existing active session for user ${user.username}`);
        const existingSession = await Session.findOne({
            where: {
                user_id: user.username,
                is_active: true
            }
        });
        if (existingSession) {
            logger.info(`Logging out previous session for user ${user.username}`);
            await cognito.adminUserGlobalSignOut({
                UserPoolId: clientConfig.USER_POOL_ID,
                Username: user.username
            }).promise();
            // Update session status in the database
            logger.info(`Updating session status for user ${user.username}`);
            await Session.update(
                { is_active: false },
                { where: { user_id: user.username } }
            );
            logger.info(`Previous session for user ${user.username} logged out successfully`);
        }
        // Authenticate with Cognito
        logger.info(`Authenticating user ${user.username} with Cognito`);
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
            logger.error("Authentication failed for user", { username: user.username });
            throw new BadRequestError("Authentication failed. Please check your credentials.");
        }
        // Generate tokens
        logger.info(`User ${user.username} authenticated successfully`);
        const tokens = authResponse.AuthenticationResult;
        // Create new session
        const refreshExpiry = device === "browser"
            ? parseInt(process.env.BROWSER_REFRESH_EXPIRY || "3600")
            : parseInt(process.env.MOBILE_REFRESH_EXPIRY || "2592000");
        logger.info("Creating new session for user after reset");
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
        logger.info(`Session created and tokens issued for user ${user.username}`);
        return {
            username: user.username,
            access_token: tokens.AccessToken,
            id_token: tokens.IdToken,
            expires_in: tokens.ExpiresIn,
            refresh_token: tokens.RefreshToken,
            refresh_expires_in: refreshExpiry
        };
    } catch (error) {
        logger.error({
            message: error.message || 'Failed to reset session',
            code: error.code || 'UnknownError',
            stack: error.stack || 'No stack trace available',
        });
        if (error instanceof AppError) {
            throw error;
        }
        throw new InternalServerError('Failed to reset session');
    }
};

const generateTokens = async (refreshToken, username, role, device, device_id, ip_address) => {
    logger.info("Starting token generation process");
    if (!device_id) {
        logger.error("Device ID is missing");
        throw new BadRequestError("Device ID is required");
    };
    if (!ip_address) {
        logger.error("IP Address is missing");
        throw new BadRequestError("IP Address is required");
    };
    logger.appendKeys({ role, device, device_id, ip_address });
    if (!refreshToken) {
        logger.error("Refresh token is missing");
        throw new BadRequestError("Refresh token is required");
    };
    if (!username) {
        logger.error("Username is missing");
        throw new BadRequestError("Username is required");
    };
    if (!role) {
        logger.error("Role is missing");
        throw new BadRequestError("Role is required");
    };
    const clientConfig = CLIENTS[device]?.[role];
    if (!['browser', 'mobile'].includes(device)) {
        logger.error("Invalid device provided");
        throw new BadRequestError("Device must be either 'browser' or 'mobile'");
    };
    if (!clientConfig) throw new BadRequestError("Invalid device or role");
    new CognitoIdentityProviderClient({ region: process.env.AWS_REG });
    logger.info(`Generating tokens for user: ${username}`);
    try {
        const params = {
            AuthFlow: 'REFRESH_TOKEN_AUTH',
            ClientId: clientConfig.CLIENT_ID,
            AuthParameters: {
                REFRESH_TOKEN: refreshToken,
                SECRET_HASH: generateSecretHash(username, clientConfig),
                USERNAME: username
            }
        };
        logger.info("Initiating token refresh with Cognito");
        const response = await cognito.initiateAuth(params).promise();
        if (!response || !response.AuthenticationResult) {
            logger.error("No authentication result returned from Cognito");
            throw new BadRequestError("Failed to refresh tokens");
        }
        logger.info(`Tokens generated successfully for user: ${username}`);
        return {
            access_token: response.AuthenticationResult.AccessToken,
            id_token: response.AuthenticationResult.IdToken,
            expires_in: response.AuthenticationResult.ExpiresIn,
            refresh_token: response.AuthenticationResult.RefreshToken || refreshToken,
        };
    } catch (error) {
        logger.error({
            message: error.message || 'Refresh token expired! Please login again.',
            code: error.code || 'UnknownError',
            stack: error.stack || 'No stack trace available',
        });
        if (error instanceof AppError) {
            throw error;
        }
        throw new InternalServerError("Refresh token expired! Please login again.");
    };
};

const generatePreSignedUrl = (file_type, folder, file_name, role, device, device_id, ip_address) => {
    if (!role) {
        throw new BadRequestError('Role is required');
    }
    if (!device) {
        throw new BadRequestError('Device is required');
    }
    if (!device_id) {
        throw new BadRequestError('Device ID is required');
    }
    if (!ip_address) {
        throw new BadRequestError('IP Address is required');
    }
    logger.appendKeys({ role, device, device_id, ip_address });
    if (!file_type) {
        throw new BadRequestError("File type is missing for the image");
    }
    if (!folder) {
        throw new BadRequestError("Unable to upload the image");
    }
    if (!file_name) {
        throw new BadRequestError('File name is missing for the image');
    }
    const extension = file_type.split("/")[1];
    const timestamp = Date.now();
    folder = folder || "uploads";
    file_name = file_name || `${timestamp}`;
    const key = `${folder}/${file_name}.${extension}`;
    logger.info(`Generating pre-signed URL for file (Key): ${key}`);
    const params = {
        Bucket: process.env.S3_BUCKET_NAME,
        Key: key,
        Expires: 300,
        ContentType: file_type,
    };
    logger.info("Creating S3 client for pre-signed URL generation");
    const uploadURL = s3.getSignedUrl("putObject", params);
    const fileUrl = `https://${process.env.S3_BUCKET_NAME}.s3.amazonaws.com/${key}`;
    logger.info(`Pre-signed URL generated successfully for file type: ${file_type}`);
    return { uploadURL, fileUrl, key };
};

const assignImage = async (username, image_url, role, device, device_id, ip_address) => {
    logger.appendKeys({ role, device, device_id, ip_address });
    if (!role) throw new BadRequestError('Role is required');
    if (!device) {
        throw new BadRequestError('Device is required');
    }
    if (!device_id) {
        throw new BadRequestError('Device ID is required');
    }
    if (!ip_address) {
        throw new BadRequestError('IP Address is required');
    }
    logger.appendKeys({ role, device, device_id, ip_address });
    const [updatedCount] = await User.update(
        { profile_pic_url: image_url },
        { where: { id: username } }
    );
    if (updatedCount === 0) {
        throw new BadRequestError(`No user found with ID: ${username}`);
    }
    logger.info(`Profile picture updated for user ID: ${username}`);
};

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
    generatePreSignedUrl,
    assignImage
};