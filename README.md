# 🛡️ Serverless Auth API with AWS Cognito, Lambda, API Gateway & Neon.tech

This project implements a scalable, secure **serverless REST API** backend that supports full **user authentication and authorization** via **AWS Cognito**, with user data persisted in **Neon.tech's serverless PostgreSQL** database.

Supports:
- ✅ Signup with **email** and **phone number**
- ✅ OTP verification to **both email and phone**
- ✅ Login with **email/username/phone + password** or **OTP**
- ✅ Role-based access (Admin/User)
- ✅ Serverless deployment using **API Gateway + Lambda**
- ✅ Clean **REST API** interface usable by web/mobile clients

---

## 🔧 Tech Stack

| Layer       | Service                     |
|------------|-----------------------------|
| Auth        | AWS Cognito User Pools      |
| API Gateway | Amazon API Gateway          |
| Compute     | AWS Lambda                  |
| Database    | Neon.tech (PostgreSQL)      |
| Language    | Node.js with Express        |
| Infra       | Serverless Framework or SAM |

---

## 📌 Features

### 🔐 Signup (`/signup`)
- Accepts `email`, `phone_number`, and `password`
- Generates random UUID as Cognito `username`
- Triggers OTP to both **email** and **phone**
- Adds user record to Neon DB upon confirmation

### ✅ Confirm Signup (`/confirm`)
- Confirms Cognito signup via OTP (email or phone)
- Authenticates user
- Checks if both email & phone are verified
- If not, triggers secondary OTP for unverified attribute

### 🔑 Sign In (`/signin`)
- Sign in using:
  - Email + password
  - Phone + password
  - Username + password
- Returns JWT tokens (ID, access, refresh)

### 🔁 Login with OTP (TBD)
- Optional support for passwordless login with OTP (email/phone)

### 👤 Get User Info (`/getuser`)
- Protected route (Cognito Auth)
- If user is **admin** → returns **all users**
- If user is **normal** → returns only their own data

---

## 🗃️ Database Schema (PostgreSQL)

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  phone TEXT UNIQUE,
  role TEXT DEFAULT 'user',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
