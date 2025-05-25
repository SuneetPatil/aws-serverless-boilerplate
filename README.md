# 🛡️ Serverless Auth REST API with AWS Cognito, Lambda, API Gateway & Neon.tech

This project is a fully serverless REST API backend built with Node.js + Express, designed for web and mobile apps, and powered by:

- AWS Cognito for authentication
- API Gateway + AWS Lambda for scalable compute
- Neon.tech for a serverless PostgreSQL database
- Support for OTP login, device-aware token lifetimes, SSO enforcement, and password reset

## ✅ Key Features

- 🔐 Signup with email + phone, with OTP verification to both
- 🔑 Login using email/username/phone + password
- 🔁 Passwordless OTP login via email or phone
- 🆘 Forgot password + OTP-based reset
- ✉️ Send OTP endpoint for login flows
- 🎭 Role-based access: admin vs user
- 📱 Device-aware token expiry:
  - Mobile: 1 day access / 30 days refresh
  - Browser: 30 min access / 1 hour refresh
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
| Cognito      | ❌ No (avoid Cognito groups unless IAM is involved) |
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

DATABASE_URL=your_neon_database_url

COGNITO_USER_POOL_ID=your_user_pool_id
COGNITO_WEB_CLIENT_ID=your_browser_app_client_id
COGNITO_MOBILE_CLIENT_ID=your_mobile_app_client_id

TOKEN_EXPIRY_BROWSER=1800        # 30 mins
TOKEN_EXPIRY_MOBILE=86400        # 1 day
REFRESH_EXPIRY_BROWSER=3600      # 1 hour
REFRESH_EXPIRY_MOBILE=2592000    # 30 days

##  📁 API Reference

| Endpoint                    | Method | Auth | Description                                    |
|-----------------------------|--------|------|------------------------------------------------|
| /signup                     | POST   | ❌   | Register with email, phone, and password       |
| /confirm                    | POST   | ❌   | Confirm signup using OTP                       |
| /signin                     | POST   | ❌   | Login with password and device info            |
| /signin-otp                 | POST   | ❌   | Login with OTP (email/phone) and device info   |
| /send-otp                   | POST   | ❌   | Send OTP for login                             |
| /forgot-password            | POST   | ❌   | Send OTP for password reset                    |
| /reset-password             | POST   | ❌   | Reset password using OTP                       |
| /getuser                    | GET    | ✅   | Admin gets all users, user gets self           |
| /session/confirm-logout     | POST   | ✅   | Confirm and revoke old session if needed       |

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
  "role": "user"
}

Success Response:
- HTTP 201 Created
- JSON with user UUID and next steps (e.g., confirm OTP)

Error Responses:
- HTTP 400 Bad Request → Missing or invalid request fields
- HTTP 409 Conflict → Email or phone number already exists
- HTTP 500 Internal Server Error → Cognito or DB-related failure

Flow:
- Checks if the provided email and/or phone number already exist in AWS Cognito using IAM Programmatic User permissions.
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
  "code": "123456"
}

Success Response:
- HTTP 200 OK
- JSON indicating verification success
- Returns OAuth tokens if both email and phone are verified

Error Responses:
- HTTP 400 Bad Request → Missing or invalid fields (email/phone/code)
- HTTP 404 Not Found → User not found
- HTTP 409 Conflict → Attribute already verified
- HTTP 500 Internal Server Error → Cognito failure or unexpected issue

Flow:
- Checks if the provided email or phone number exists in AWS Cognito using IAM Programmatic User permissions.
- If the attribute exists and is not yet verified:
    - Confirms the user using the provided OTP code.
    - If the attribute is already verified or After successful verification:
        - If the other attribute (email or phone) also exists and is not yet verified:
            - Triggers Cognito to send OTP for that unverified attribute using IAM Programmatic User permissions.
        - If both attributes are verified:
            - Issues OAuth tokens (if automatic login post-verification is supported).
- All errors (invalid code, user not found, etc.) are handled gracefully with structured messages and proper HTTP status codes.
```
### Sign In with Password (/signin)
POST /signin
{
  "username": "jane@example.com",
  "password": "StrongPassword123!",
  "device": "browser"
}

- Chooses Cognito client based on device
- If another session exists, prompts for logout

### Sign In with OTP (/signin-otp)
POST /signin-otp
{
  "username": "jane@example.com",
  "otp": "123456",
  "device": "mobile"
}

- Logs in with OTP only (no password)

### Send OTP (/send-otp)
POST /send-otp
{
  "username": "jane@example.com"
}
→ Sends OTP to registered email/phone

### Forgot Password (/forgot-password)
POST /forgot-password
{
  "username": "jane@example.com"
}
→ Sends OTP to registered email/phone for reset

### Reset Password (/reset-password)
POST /reset-password
{
  "username": "jane@example.com",
  "code": "123456",
  "new_password": "NewSecurePassword@2025"
}
→ Verifies OTP and updates password

### Get User (/getuser)
- Requires Authorization header with valid JWT
- If user is admin, returns all users
- If user is user, returns only their own profile

### Confirm Logout of Previous Session (/session/confirm-logout)
POST /session/confirm-logout
{
  "previous_session_id": "uuid-of-old-session",
  "confirm": true
}

- Used when a new session attempts to replace an active one

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
