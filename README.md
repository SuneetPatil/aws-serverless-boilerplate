# 🛡️ Serverless Auth REST API with AWS Cognito, Lambda, API Gateway & Neon.tech

This project is a fully serverless REST API backend built with Node.js + Express, designed for web and mobile apps, and powered by:

- AWS Cognito for authentication
- API Gateway + AWS Lambda for scalable compute
- Neon.tech for a serverless PostgreSQL database
- Support for OTP login, device-aware token lifetimes, and SSO enforcement

## ✅ Key Features

- 🔐 Signup with email + phone, with OTP verification to both
- 🔑 Login using email/username/phone + password
- 🔁 Passwordless OTP login via email or phone
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

- A new session is created for each login with device info
- If a previous session is active:
  - User is prompted to confirm logout of old session
  - On confirmation, old session is revoked, new session activated
- Only 1 active session per user is allowed at a time


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

##  📁 API Reference

| Endpoint                    | Method | Auth | Description                                    |
|-----------------------------|--------|------|------------------------------------------------|
| /signup                     | POST   | ❌   | Register with email, phone, and password       |
| /confirm                    | POST   | ❌   | Confirm signup using OTP                       |
| /signin                     | POST   | ❌   | Login with password and device info            |
| /signin-otp                 | POST   | ❌   | Login with OTP (email/phone) and device info   |
| /getuser                    | GET    | ✅   | Admin gets all users, user gets self           |
| /session/confirm-logout     | POST   | ✅   | Confirm and revoke old session if needed       |

## 📁 Recommended Project Structure

```text
serverless-auth-api/
├── src/
│   ├── controllers/       → Route handlers (signup, login, user info)
│   ├── services/          → Cognito + session logic
│   ├── routes/            → Express routers
│   ├── middlewares/       → Auth & role guards
│   ├── utils/             → Helpers (tokens, logging)
│   ├── config/            → Env and service configs
│   ├── db/                → DB init and queries
│   ├── app.js             → Express app
│   └── handler.js         → Lambda adapter
├── tests/                 → Unit tests
├── serverless.yml         → Serverless Framework config
├── .env                   → Environment variables
├── package.json
└── README.md / README.txt
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

##  🔐 Auth Flows

### Signup (/signup)
POST /signup
{
  "first_name": "Jane",
  "last_name": "Doe",
  "email": "jane@example.com",
  "phone_number": "+911234567890",
  "password": "StrongPassword123!"
}

- Triggers OTP to both email and phone
- Stores preliminary user metadata

### Confirm Signup (/confirm)
POST /confirm
{
  "username": "uuid-from-signup",
  "code": "123456"
}

- Confirms via OTP
- If only one verified, triggers OTP for the unverified attribute

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

## 🧾 License

MIT License
