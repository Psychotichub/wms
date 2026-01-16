# WMS Backend Project Documentation

## 📋 Overview
The WMS (Work Management System) Backend is a **Node.js/Express** application that serves as the central API for the WMS platform. It manages authentication, data persistence (MongoDB), and business logic for reporting, employee management, and inventory.

## 🛠 Tech Stack
-   **Runtime**: Node.js
-   **Framework**: Express.js
-   **Database**: MongoDB (via Mongoose)
-   **Authentication**: JWT (JSON Web Tokens)
-   **Validation**: Zod
-   **Security**: Helmet, Express Rate Limit, bcryptjs

## 📂 Project Structure
```
backend/
├── src/
│   ├── config/         # Database configuration (db.js)
│   ├── middleware/     # Custom middleware (auth.js, validation.js)
│   ├── models/         # Mongoose Schemas (User, Employee, Report, etc.)
│   ├── routes/         # API Route definitions
│   └── server.js       # Entry point
├── .env                # Environment variables
├── eslint.config.js    # Linting configuration
└── package.json        # Dependencies
```

## 🔐 Security Implementations
1.  **Authentication**:
    -   JWT-based stateless authentication.
    -   Secure password hashing using `bcryptjs`.
    -   **Device Binding**: Prevents login from unauthorized devices if enabled for a user.
2.  **Input Validation**:
    -   Requests to `/api/auth` (Login/Signup) are validated using **Zod** schemas to prevent injection and ensure data integrity.
3.  **Server Hardening**:
    -   **Helmet**: Sets secure HTTP headers (e.g., `Strict-Transport-Security`, `X-Content-Type-Options`).
    -   **Rate Limiting**: Limits requests to 100 per 15 minutes per IP to mitigate brute-force attacks.
4.  **Role-Based Access Control (RBAC)**:
    -   Middleware (`requireAdmin`, `requireManager`) restricts access to sensitive endpoints.

## 🚀 Key Features & APIs
-   **Auth**: `/api/auth` - Login, Signup, Refresh Token.
-   **Employees**: `/api/employees` - Manage staff, Geofenced Clock-in/out.
-   **Reports**: `/api/reports` - Daily work reports.
-   **Materials**: `/api/materials` - Inventory and pricing.
-   **Notifications**: `/api/notifications` - Push notifications for system events.
-   **Time Tracking**: `/api/time` - Task-based time logging.
-   **Locations**: `/api/locations` - Geofence definitions for sites.

## ⚙️ Setup & Running
1.  **Install**: `npm install`
2.  **Lint**: `npm run lint`
3.  **Dev Server**: `npm run dev` (starts nodemon on port 4000)
4.  **Production**: `npm start`
