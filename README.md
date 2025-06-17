# 🛡️ Serverless Auth REST API with AWS Cognito, Lambda, API Gateway & Neon.tech

This project is a fully serverless REST API backend built with Node.js + Express, designed for web and mobile apps, and powered by:

- AWS Cognito for authentication
- API Gateway + AWS Lambda for scalable compute
- Neon.tech for a serverless PostgreSQL database
- Support for OTP login, device-aware token lifetimes, SSO enforcement, and password reset

## ✅ Key Features

- 🎭 Role-based access: admin vs user
- 📱 Device-aware token expiry:
  - Mobile: 1 day access / 30 days refresh
  - Browser: 30 min access / 1 hour refresh
- 📱 Tracks device_id and ip_address for each user session to improve security, enable precise device-specific session management, support anomaly detection, and provide detailed audit trails of user session activities.
- 🔐 Signup with email + phone, with OTP verification to both
- 🔑 Login using email/username/phone + password
- 🔁 Passwordless OTP login via email or phone
- 🆘 Forgot password + OTP-based reset
- 🔐 Single Sign-On (SSO): one active session per user; logout on new login
- REST API usable by web and mobile clients
- Serverless deployment with API Gateway + Lambda

## 🔧 Tech Stack

| Layer       | Service                     |
|------------|-----------------------------|
| Auth        | AWS Cognito User Pools      |
| API Gateway | Amazon API Gateway          |
| Compute     | AWS Lambda                  |
| Database    | Neon.tech (PostgreSQL)      |
| Language    | Node.js with Express        |
| Infra       | Serverless Framework / SAM  |


## ⚙️ Setup

### Cognito Configuration

User Pool Setup:
- Attributes required: email, phone_number
- Auto-verification: Enabled for both email and phone
- Username: Random UUID assigned during signup
- MFA: Optional or Required (as per OTP flow design)
- Role Storage: Roles like admin/user are stored in PostgreSQL DB

Create two App Clients in Cognito:
| Client         | Access Token | Refresh Token |
|----------------|--------------|----------------|
| web-client     | 30 mins      | 1 hour         |
| mobile-client  | 1 day        | 30 days        |

Client IDs will be dynamically selected during login based on the `device` parameter.

## 🧠 Strategy - Session & SSO Logic

- Each login creates a new session with `device_type`
- If an existing session is active:
  - User prompted to confirm logout
  - If confirmed, previous session is revoked
- Only 1 active session per user at a time


### 🔐 Role Management Strategy

| Role Storage | Recommendation |
|--------------|----------------|
| Cognito      | ✅ Yes – store in different user pool based on role |
| DB           | ✅ Yes – store in users.role column |

Use JWT token’s sub to fetch user and validate their role in protected routes.

### 📲 Device-Aware Token Strategy

| Device   | Access Token Expiry | Refresh Token Expiry |
|----------|---------------------|-----------------------|
| browser  | 30 minutes          | 1 hour                |
| mobile   | 1 day               | 30 days               |

Tokens are managed via two Cognito App Clients.
Your login APIs dynamically select the client ID based on the device parameter.

##  🗃️ Database Schema (PostgreSQL)
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,              -- Cognito sub UUID
  first_name TEXT,
  last_name TEXT,
  email TEXT UNIQUE NOT NULL,        -- User email (unique)
  phone TEXT UNIQUE,                 -- Phone number (unique)
  role TEXT DEFAULT 'user',          -- Role: 'user' or 'admin'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
  session_id UUID PRIMARY KEY,       -- Unique session ID
  user_id UUID NOT NULL,             -- FK to users(id)
  device_type TEXT,                  -- 'browser' or 'mobile'
  refresh_token TEXT,                -- Encrypted refresh token
  device_id TEXT,                    -- Unique device identifier
  ip_address TEXT,                   -- IP address of the request origin
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP,              -- Expiry time for session
  is_active BOOLEAN DEFAULT TRUE     -- Flag to enforce SSO
);
```

## 📁 Recommended Project Structure

```text
serverless-auth-api/
├── src/
│   ├── controllers/        → Route logic (signup, login, reset, user info)
│   ├── services/           → Cognito, OTP, and session logic
│   ├── routes/             → Express route definitions
│   ├── middlewares/        → Auth checks and role guards
│   ├── utils/              → Utility functions
│   ├── config/             → Configuration and environment setup
│   ├── db/                 → DB connection and queries
│   ├── app.js              → Main Express application
│   └── handler.js          → AWS Lambda adapter
├── tests/                  → Unit and integration tests
├── serverless.yml          → Serverless Framework config
├── .env                    → Environment variables
├── package.json            → Node.js dependencies and scripts
└── README.txt              → Project documentation
```

### ⚙️ Environment Variables
```
DATABASE_URL=your_neon_database_url

COGNITO_USER_POOL_ID=your_user_pool_id
COGNITO_WEB_CLIENT_ID=your_browser_app_client_id
COGNITO_MOBILE_CLIENT_ID=your_mobile_app_client_id

TOKEN_EXPIRY_BROWSER=1800        # 30 mins
TOKEN_EXPIRY_MOBILE=86400        # 1 day
REFRESH_EXPIRY_BROWSER=3600      # 1 hour
REFRESH_EXPIRY_MOBILE=2592000    # 30 days
```

##  📁 API Reference

| Endpoint                  | Method | Auth  | Description                                                              |
| ------------------------- | ------ | ------| ------------------------------------------------------------------------ |
| `/signup`                 | POST   | ❌    | Register with email, phone, and password                                |
| `/confirm`                | POST   | ❌    | Confirm signup using OTP                                                |
| `/signin`                 | POST   | ❌    | Login with password and device info                                     |
| `/send-otp`               | POST   | ❌    | Send OTP for login                                                      |
| `/signin-otp`             | POST   | ❌    | Login with OTP (email/phone) and device info                            |
| `/forgot-password`        | POST   | ❌    | Send OTP for password reset                                             |
| `/reset-password`         | POST   | ❌    | Reset password using OTP                                                |
| `/getuser`                | GET    | ✅    | Admin gets all users, user gets self                                    |
| `/session/status`         | GET    | ✅    | Check current session status for logged-in user                         |
| `/session/logout`         | POST   | ✅    | Logs out the current session, revoking refresh tokens                   |
| `/session/reset`          | POST   | ❌    | Logs out all sessions for a user and creates a new active session       |
| `/session/refreshToken`   | POST   | ❌    | Generates new id, access & refresh token pair using valid refresh token |

##  🔐 API Flows (ROLE: user)

### Signup (/signup)
```text
Method: POST
Description: Registers a new user with email, phone number, password, and role.

Request Body: 
{
  "first_name": "Jane",
  "last_name": "Doe",
  "email": "jane@example.com",
  "phone_number": "+911234567890",
  "password": "StrongPassword123!",
  "role": "user",
  "device": "browser",
  "device_id": "f6b4e58a-9c1d-4a2f-9f8a-1b2e3c4d5f6a",
  "ip_address": "192.168.1.10"
}

Success Response:
- HTTP 201 Created
- JSON with user UUID and next steps (e.g., confirm OTP)

Error Responses:
- HTTP 400 Bad Request → Missing or invalid request fields
- HTTP 409 Conflict → Email or phone number already exists
- HTTP 500 Internal Server Error → Cognito or DB-related failure

Flow:
- Checks if the provided email and/or phone number already exist against the given role in AWS Cognito using IAM Programmatic User permissions.
- If not, 
  - If both email and phone number are available:
      - A new user is created in Cognito with a randomly generated UUID as the username.
  - If only one identifier is available (email or phone):
      - That value is used as the Cognito username.
  - User metadata (name, email, phone, role) is also stored in the 'users' table in PostgreSQL.
  - The same UUID is used to store the user record in the PostgreSQL database.
  - Cognito triggers OTP for verification:
      - To email, if only email is provided
      - To phone, if only phone or both email and phone is provided
- Handles all failures gracefully and returns meaningful error codes and messages.
```

### Confirm Signup / Verify Email or Phone Number (/confirm)
```text
Method: POST
Description: Confirms user signup by verifying the provided email or phone number using an OTP.

Request Body:
{
  "email": "jane@example.com",    // OR
  "phone_number": "+911234567890",
  "code": "123456",
  "password": "StrongPassword123!",
  "role": "user",
  "device": "browser",
  "device_id": "f6b4e58a-9c1d-4a2f-9f8a-1b2e3c4d5f6a",
  "ip_address": "192.168.1.10"
}

Success Response:
- HTTP 200 OK
- JSON indicating verification success with access and refresh tokens
- If an active session exists, response may include a flag to confirm logout of previous session

Error Responses:
- HTTP 400 Bad Request → Missing or invalid fields (email/phone/code)
- HTTP 404 Not Found → User not found
- HTTP 409 Conflict → Attribute already verified
- HTTP 500 Internal Server Error → Cognito failure or unexpected issue

Flow:
- Checks if the provided email or phone number exists in AWS Cognito using IAM Programmatic User permissions.
- If the attribute exists and is not yet verified:
    - Confirms the user using the provided OTP code and password.
    - Verify the attribute
- If the attribute is already verified or After successful verification:
    - If the other attribute (email or phone) also exists and is not yet verified:
        - Triggers Cognito to send OTP for that unverified attribute using User password permissions.
    - If both attributes are verified:
        - Checks in the PostgreSQL `sessions` table if an active session exists for the user.
        - If another active session is found:
            - Returns a flag prompting the user to confirm logout of the previous session.
            - New session is not created until the previous one is revoked (SSO enforcement).
        - If no other session exists:
             - Creates a new session entry in the DB, tied to user ID, device type, device_id, and ip_address.
            - Stores refresh token and session expiry.
    - Tokens are returned in the response.
- All errors (invalid code, user not found, etc.) are handled gracefully with structured messages and proper HTTP status codes.
```

### Sign In with Password (/signin)
```text
Method: POST
Description: Authenticates a user using email, phone number, or username with a password and device type.

Request Body:
{
  "username": "jane@example.com",   // can be email, phone_number, or Cognito username (UUID)
  "password": "StrongPassword123!",
  "role": "user",
  "device": "browser"               // values: "browser" or "mobile"
  "device_id": "f6b4e58a-9c1d-4a2f-9f8a-1b2e3c4d5f6a",
  "ip_address": "192.168.1.10"
}

Success Response:
- HTTP 200 OK
- JSON with access and refresh tokens
- If an active session exists, response may include a flag to confirm logout of previous session

Error Responses:
- HTTP 400 Bad Request → Missing or invalid input fields
- HTTP 401 Unauthorized → Invalid credentials or user not verified
- HTTP 403 Forbidden → Account disabled or not confirmed
- HTTP 500 Internal Server Error → Cognito or DB-related failure

Flow:
- Determines the device type (`browser` or `mobile`) and selects the corresponding Cognito App Client ID.
    - `browser` → 30 min access / 1 hour refresh
    - `mobile` → 1 day access / 30 days refresh
- Authenticates the user with Cognito using the provided username and password.
    - Username can be an email, phone number, or UUID (Cognito username).
    - Identify using REGEX - Numeric(phone_number), AlphaNumber(UUID), and include @(special character for email)
- On successful authentication:
    - If user is not confirmed email and/or phone_number
        - Cognito triggers OTP for verification:
        - To email, if only email is provided
        - To phone, if only phone or both email and phone is provided
    - If user is verified
        - Checks in the PostgreSQL `sessions` table if an active session exists for the user.
        - If another active session is found:
            - Returns a flag prompting the user to confirm logout of the previous session.
            - New session is not created until the previous one is revoked (SSO enforcement).
        - If no other session exists:
            - Creates a new session entry in the DB, tied to user ID, device type, device_id, and ip_address.
            - Stores refresh token and session expiry.
        - Tokens are returned in the response.
- All errors (invalid password, user not found, unverified email/phone) are handled gracefully and returned with appropriate HTTP status codes and messages.
```

### Send OTP (/send-otp)
```text
Method: POST  
Description: Sends a One-Time Password (OTP) to the user's verified or unverified email or phone number for login or verification purposes.

Request Body:
{
  "email": "jane@example.com",        // OR
  "phone_number": "+911234567890",
  "device": "mobile",                 // values: "browser" or "mobile"
  "role": "user"
  "device_id": "f6b4e58a-9c1d-4a2f-9f8a-1b2e3c4d5f6a",
  "ip_address": "192.168.1.10"
}

Success Response:
- HTTP 200 OK
- JSON indicating that OTP was sent successfully 
  e.g., {
          "message": "OTP sent to your email/phone number.",
          "session": "AYABeLMwPRBxLhBp50-tEwnxSREAHQABAAdTZXJ2aWNlABBDb2duaXRvVXNlclBv.."
        }

Error Responses:
- HTTP 400 Bad Request → Missing or invalid input fields
- HTTP 404 Not Found → User not found
- HTTP 409 Conflict → Email or phone number already verified (if contextually invalid)
- HTTP 500 Internal Server Error → Cognito-related issue or other failures

Flow:
- Validates the request to ensure either `email` or `phone_number` is provided, along with `device` and `role`.
- Identifies the user in AWS Cognito using IAM Programmatic User permissions based on the provided email or phone number.
- Checks whether the corresponding attribute (email/phone) exists and is not disabled.
- Triggers Cognito to send an OTP:
    - If the user is signing in → Initiates an authentication challenge with CUSTOM_AUTH flow.
    - If the user is verifying their account (e.g., after signup) → Uses `AdminCreateUser`/`AdminUpdateUserAttributes` to resend confirmation code.
- Handles duplicate OTP triggers gracefully (e.g., cooldown enforcement if needed).
- Returns success message or error response accordingly.
- All exceptions are logged and surfaced through appropriate error codes and messages.
```

### Sign In with OTP (/signin-otp)
```text
Method: POST  
Description: Authenticates a user using an OTP sent to their registered email or phone number, based on the device type.

Request Body:
{
  "email": "jane@example.com",         // OR
  "phone_number": "+911234567890",
  "otp": "123456",
  "session": "AYABeLMwPRBxLhBp50-tEwnxSREAHQABAAdTZXJ2aWNlABBDb2duaXRvVXNlclBv...",
  "role": "user",
  "device": "browser"                   // values: "browser" or "mobile"
  "device_id": "f6b4e58a-9c1d-4a2f-9f8a-1b2e3c4d5f6a",
  "ip_address": "192.168.1.10"
}

Success Response:
- HTTP 200 OK
- JSON with access and refresh tokens
- If an active session exists, response may include a flag to confirm logout of previous session

Error Responses:
- HTTP 400 Bad Request → Missing or invalid fields (email/phone/otp)
- HTTP 401 Unauthorized → Incorrect OTP or user not verified
- HTTP 403 Forbidden → OTP expired or account disabled
- HTTP 404 Not Found → User not found
- HTTP 500 Internal Server Error → Cognito or DB-related failure

Flow:
- Determines the device type (`browser` or `mobile`) and selects the corresponding Cognito App Client ID:
    - `browser` → 30 min access / 1 hour refresh
    - `mobile` → 1 day access / 30 days refresh
- Identifies the user based on the provided `email` or `phone_number`.
- Uses Cognito’s `AdminInitiateAuth` with `CUSTOM_AUTH` or `OTP` challenge flow to verify OTP.
- On successful authentication:
    - If attribute(email/phone_number) is not verify, explictly verify it
    - Checks in the PostgreSQL `sessions` table if an active session already exists for the user.
    - If another active session is found:
        - Returns a flag prompting the user to confirm logout of the previous session.
        - New session is not created until the previous one is revoked (SSO enforcement).
    - If no other session exists:
        - Creates a new session entry in the DB, tied to user ID, device type, device_id, and ip_address.
        - Stores refresh token and session expiry.
    - Access and refresh tokens are returned in the response.
- All errors (invalid OTP, unverified user, expired OTP, etc.) are handled gracefully with clear messaging and appropriate HTTP status codes.
```

### Forgot Password (/forgot-password)
```text
Method: POST  
Description: Initiates the password reset flow by sending an OTP to the user's registered email or phone number.

Request Body:
{
  "email": "jane@example.com",         // OR
  "phone_number": "+911234567890",
  "role": "user",
  "device": "browser"                  // values: "browser" or "mobile"
  "device_id": "f6b4e58a-9c1d-4a2f-9f8a-1b2e3c4d5f6a",
  "ip_address": "192.168.1.10"
}

Success Response:
- HTTP 200 OK  
- JSON message indicating that the OTP has been sent:
  {
    "status": "success",
    "code": 200,
    "message": "OTP sent to your registered email or phone number."
  }

Error Responses:
- HTTP 400 Bad Request → Missing or invalid input (no email/phone, wrong format)
- HTTP 404 Not Found → No user found with the provided email or phone number
- HTTP 429 Too Many Requests → Rate limit exceeded for sending OTPs
- HTTP 500 Internal Server Error → Cognito or internal service failure

Flow:
- Accepts either `email` or `phone_number` (but not both), along with `role` and `device`.
- Validates the input and checks for existence of the user in AWS Cognito using IAM Programmatic User permissions.
- If user exists:
    - Determines which Cognito App Client to use based on `device` type:
        - `browser` → shorter expiry tokens
        - `mobile` → longer expiry tokens
    - Initiates Cognito’s `forgotPassword` flow which triggers an OTP to the user’s verified email or phone.
- If the email/phone is not registered or not verified, responds with an appropriate error.
- Prevents abuse by rate-limiting OTP sends (handled by Cognito and optionally your app logic).
- Handles all exceptions gracefully and returns appropriate HTTP status codes and structured messages.
```

### Reset Password (/reset-password)
```text
Method: POST  
Description: Completes the password reset flow by verifying the OTP and setting a new password.

Request Body:
{
  "email": "jane@example.com",         // OR
  "phone_number": "+911234567890",
  "code": "123456",
  "new_password": "NewStrongPassword!23",
  "role": "user",
  "device": "browser"                  // values: "browser" or "mobile"
  "device_id": "f6b4e58a-9c1d-4a2f-9f8a-1b2e3c4d5f6a",
  "ip_address": "192.168.1.10"
}

Success Response:
- HTTP 200 OK  
- JSON message indicating password reset success:
  {
    "status": "success",
    "code": 200,
    "message": "Password has been successfully reset."
  }

Error Responses:
- HTTP 400 Bad Request → Missing or invalid input fields
- HTTP 401 Unauthorized → Invalid OTP or expired code
- HTTP 403 Forbidden → User not confirmed or disabled
- HTTP 404 Not Found → User not found with given email or phone
- HTTP 500 Internal Server Error → Cognito or database failure

Flow:
- Accepts either `email` or `phone_number`, the OTP `code`, and the new password.
- Validates request and identifies user in AWS Cognito using IAM Programmatic User permissions.
- Invokes Cognito’s `confirmForgotPassword` API with:
    - The username (derived from email or phone)
    - The OTP code sent via `/forgot-password`
    - The new password
- If the OTP is valid and password meets complexity requirements:
    - Cognito resets the password and the user can now log in with the new credentials.
- All errors such as invalid/expired code, unverified user, or weak password are handled with proper HTTP codes and messages.
- No new session is created as part of this flow. The user must log in again via `/signin`.
```

### Get User (/getuser)
```text
Method: GET  
Description: Retrieves the authenticated user's profile information using the provided access token.

Headers:
Authorization: Bearer <access_token>
role: user
device: browser
device_id: f6b4e58a-9c1d-4a2f-9f8a-1b2e3c4d5f6a,
ip_address: 192.168.1.10

Success Response:
- HTTP 200 OK  
- JSON containing user profile data:

"status": "success",
"code": 200,
"message": "User data fetched successfully",
data: {
"user_id": "uuid-1234-5678",
"first_name": "Jane",
"last_name": "Doe",
"email": "jane@example.com",
"phone_number": "+911234567890",
"role": "user",
"is_email_verified": true,
"is_phone_verified": true
}

Error Responses:
- HTTP 401 Unauthorized → Missing or invalid token
- HTTP 403 Forbidden → Token is valid but user is not authorized for this action
- HTTP 404 Not Found → User record not found in database
- HTTP 500 Internal Server Error → Token decoding or DB-related failure

Flow:
- Requires a valid JWT `access_token` in the `Authorization` header (format: `Bearer <token>`).
- Server performs JWT verification using AWS Cognito's public keys to validate the token signature and expiry.
- If the token is invalid or expired, returns 401 Unauthorized.
- On successful verification, extracts the Cognito `sub` (UUID) from the token payload.
- Queries the PostgreSQL `users` table to retrieve user metadata using this UUID.
- If user is found, returns user profile including names, contact info, role, and verification statuses.
- If user record is not found in DB, returns 404 Not Found.
- Any internal failures (token parsing, DB errors) return 500 with meaningful messages.
```
### Get Session Status (/session/status)
```text
Method: GET  
Description: Checks if a user has an active session on a device and fetches session metadata like ip_address, device_id, and expiry.

Headers:
Authorization: Bearer <access_token>
role: user
device: browser
device_id: f6b4e58a-9c1d-4a2f-9f8a-1b2e3c4d5f6a,
ip_address: 192.168.1.10

Success Response:
- HTTP 200 OK  
- JSON containing user profile data:
{
  "status": "success",
  "code": 200,
  "message": "Active session fetched successfully",
  "data": {
    "username": "abcd1234",
    "session_id": "uu06-uu07-uu08-uu09",
    "is_active": true,
    "user_agent": "browser",
    "ip_address": "192.168.0.1",
    "device_id": "ABC12345XYZ",
    "expires_at": "2025-06-30T10:00:00.000Z"
  }
}

Error Responses:
- HTTP 401 Unauthorized → Missing or invalid token
- HTTP 400 Forbidden → Invalid device or role configuration
- HTTP 404 Not Found → User record not found
- HTTP 400 Forbidden → No active sessions found
- HTTP 500 Internal Server Error → Token decoding or DB-related failure

Flow:
- Requires a valid JWT access_token in the Authorization header (format: Bearer <token>).
- The server uses middleware to verify the JWT using AWS Cognito's public keys, ensuring the token's signature and expiry are valid.
- If the token is invalid or expired, the request is immediately rejected with a 401 Unauthorized response.
- Upon successful verification, the server extracts the UUID (username) from the token payload.
- Using this UUID, it queries the users table in PostgreSQL to retrieve user metadata.
- If a user record does not exist, it returns 404 Not Found.
- It checks if the device and role values in the headers match the allowed configuration.
- It searches for an active session in the sessions table using the user ID, and ensures it's valid for the given device and IP.
- If no active session is found, it returns 400 Bad Request with a message: "No active sessions found"
- If a valid session is found, it returns: Session details (session ID, device info, IP address, expiry)
- Any unexpected server errors (e.g., DB connection issues, invalid input format) return a 500 Internal Server Error with a meaningful message.
```

### Logout Session (/session/logout)
```text
Method: POST
Description: Logs out the user from the current session by invalidating the refresh token and marking the session inactive (is_active: false).

Request Body:
{
  "role": "user",
  "device": "browser",                  // values: "browser" or "mobile"
  "device_id": "f6b4e58a-9c1d-4a2f-9f8a-1b2e3c4d5f6a",
  "ip_address": "192.168.1.10"
}

Headers:
Authorization: Bearer <access_token>    // JWT access token of the logged-in user

Success Response:
- HTTP 200 OK  
- JSON message indicating successful logout:
  {
    "status": "success",
    "code": 200,
    "message": "Logged out successfully"
  }

Error Responses:
- HTTP 400 Bad Request → Missing or invalid input fields (role, device, device_id, ip_address)
- HTTP 401 Unauthorized → Missing or invalid JWT token
- HTTP 404 Not Found → No active session found for the user matching given details
- HTTP 500 Internal Server Error → AWS Cognito or database failure

Flow:
- Requires a valid JWT `access_token` in the `Authorization` header.
- Middleware verifies and attaches `req.user` with the username (UUID) from the token.
- The API extracts `role`, `device`, `device_id`, and `ip_address` from the request body.
- Validates all required fields; rejects request if missing or invalid.
- Calls AWS Cognito's `globalSignOut` API with the access token to invalidate the session (refresh token) on Cognito.
- Marks the matching session record in the PostgreSQL `sessions` table as inactive (`is_active = false`), matching on user ID, device type, IP, and device ID.
- If no active session is found for the given criteria, returns 404.
- If the Cognito token is already expired or invalid, returns a 400 error with message `"Session already expired"`.
- On success, returns 200 OK with confirmation message.
- No new sessions or tokens are created; user must log in again for a new session.
```

### Reset Session (/session/reset)
```text
Method: POST  
Description: Logs in the user by authenticating credentials, invalidating any previous active sessions, and creating a new session record.

Request Body:
{
  "username": "user1234",              // Optional if email or phone is provided
  "email": "jane@example.com",         // Optional if username or phone is provided
  "phone": "+911234567890",            // Optional if username or email is provided
  "password": "StrongPassword!23",    // Required for authentication
  "role": "user",                     // User role for client config (e.g., user, admin)
  "device": "browser",                 // Device type; allowed values: "browser" or "mobile"
  "device_id": "f6b4e58a-9c1d-4a2f-9f8a-1b2e3c4d5f6a",
  "ip_address": "192.168.1.10"
}

Success Response:
- HTTP 200 OK  
- JSON with session and token details:
  {
    "status": "success",
    "code": 200,
    "message": "Logged in successfully",
    "data": {
      "username": "user1234",
      "access_token": "ACCESS_TOKEN",
      "id_token": "ID_TOKEN",
      "expires_in": 3600,
      "refresh_token": "REFRESH_TOKEN",
      "refresh_expires_in": 2592000,
      "device": "browser"
    }
  }

Error Responses:
- HTTP 400 Bad Request → Missing or invalid inputs (device, role, password, identifier)
- HTTP 400 Bad Request → Authentication failure due to invalid password
- HTTP 404 Not Found → User not found in Cognito
- HTTP 409 Conflict → Email or phone not verified, triggers sending verification OTP
- HTTP 500 Internal Server Error → AWS Cognito or database errors

Flow:
- Accepts login identifiers (`username`, `email`, or `phone`) along with `password`, `role`, `device`, `device_id`, and `ip_address`.
- Validates device type, presence of login identifier, role, password, device ID, and IP address.
- Determines the identifier type (email, phone, or username) based on input format.
- Fetches user data from AWS Cognito to verify existence and retrieve attributes.
- If the user’s email or phone is unverified, sends a verification OTP and returns a verification error.
- If previous active session exists for the user, authenticates credentials and logs out that session via Cognito global sign-out, marking session inactive in the database.
- Authenticates the user against Cognito using the password.
- On successful authentication, generates new tokens and creates a new active session record with expiration based on device type.
- Returns tokens and session metadata for client use.
- Handles and propagates errors with meaningful messages for invalid inputs, authentication failures, or internal errors.
```

### Refresh Tokens (/session/refreshToken)
```text
Method: POST  
Description: Issues new access and ID tokens using a valid refresh token. Used to keep the user logged in without requiring re-authentication.

Request Body:
{
  "refresh_token": "eyJraWQiOi...",
  "username": "user1234",
  "role": "user",                     // Role used during login (e.g., "user", "admin")
  "device": "browser",                // Allowed values: "browser" or "mobile"
  "device_id": "f6b4e58a-9c1d-4a2f-9f8a-1b2e3c4d5f6a",
  "ip_address": "192.168.1.10"
}

Success Response:
- HTTP 200 OK  
- JSON with newly generated tokens:
  {
    "status": "success",
    "code": 200,
    "message": "Tokens generated successfully",
    "data": {
      "access_token": "<NEW_ACCESS_TOKEN>",
      "id_token": "<NEW_ID_TOKEN>",
      "refresh_token": "<SAME_OR_NEW_REFRESH_TOKEN>",
      "expires_in": 3600,
      "token_type": "Bearer"
    }
  }

Error Responses:
- HTTP 400 Bad Request → Missing or invalid fields (e.g., refresh token, username, role, device)
- HTTP 400 Bad Request → Invalid role-device pairing or unsupported device
- HTTP 401 Unauthorized → Expired or invalid refresh token
- HTTP 500 Internal Server Error → AWS Cognito service failure or token generation error

Flow:
- Accepts a valid `refresh_token` along with `username`, `role`, `device`, `device_id`, and `ip_address`.
- Validates required fields and device type (must be either `browser` or `mobile`).
- Retrieves client configuration (`CLIENT_ID`, `SECRET_HASH`, etc.) based on `role` and `device`.
- Uses AWS Cognito’s `initiateAuth` with `REFRESH_TOKEN_AUTH` flow to issue new tokens.
- If valid, returns fresh `access_token`, `id_token`, and optionally a new `refresh_token`.
- If refresh token is expired or invalid, instructs the user to log in again.
```

## 🚀 Deployment (Serverless Framework / SAM)

1. Set up PostgreSQL schema on Neon.tech
2. Create Cognito User Pool & 2 App Clients
3. Use Serverless Framework to deploy:
   - Lambda functions for all routes
   - API Gateway routes
4. Configure environment variables
5. Set up custom authorizer with Cognito JWTs

## 🧪 Testing Tools

- ✅ Postman collection (WIP)
- ✅ Local test using curl or Express Runner
- ✅ Serverless Offline plugin for local testing
