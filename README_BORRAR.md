
# **Visit Logs Application**

This is a Node.js application that logs client information, including IP address, geolocation data, browser details, and visit timestamps, to a PostgreSQL database. It allows viewing logs in a paginated table format.

This guide displays how to deploy the application locally and further down describes how to deploy it to Google Cloud.

This guide explains how to deploy the application to **Google Cloud App Engine** with **Cloud SQL for PostgreSQL** and **Secret Manager** for secure configuration.

> **⚠️ EDUCATIONAL PURPOSE:**
> This application is designed **for educational purposes only** to teach students how to deploy Node.js applications to Google Cloud Platform.
> - The database connection uses Cloud SQL Unix socket (secure by default via Cloud SQL proxy)
> - For production applications, review and implement additional security measures appropriate for your use case

---

## **Features**
- Logs client information (IP, user-agent, geolocation data, timestamp) to a PostgreSQL database
- Real-time geolocation lookup using ipapi.co API (city, region, country, coordinates)
- Displays logs in a paginated table with configurable records per page (10, 20, 50, 100)
- Security headers via Helmet.js (XSS protection, clickjacking prevention, etc.)
- Rate limiting on API endpoints (100 requests per IP per 15 minutes)
- Input validation for query parameters
- Health check endpoint for GCP monitoring
- Graceful shutdown handling for cloud deployments
- Uses Google Cloud Secret Manager for secure configuration
- Designed for deployment on Google Cloud App Engine with Cloud SQL

---

## **Local Setup**

### **1. Prerequisites**
- **Docker** and **Docker Compose** installed and running (for local development)
- **Node.js 22 or higher** (optional - only needed if running outside Docker)
- **Google Cloud CLI** installed and authenticated (for cloud deployment)

---

### **2. Clone the Repository**
```bash
git clone <repository-url>
cd <repository-folder>
```

---

### **3. Set Up Environment Variables**

Copy the template file to create your local environment configuration:
```bash
cp .env.template .env
```

This creates a `.env` file with the following default values:
```bash
POSTGRES_USER=secure_user
POSTGRES_PASSWORD=secure_password
POSTGRES_DB=client_info
```

**Note:**
- You can change these values to use different credentials if desired
- When running with Docker Compose, the `DATABASE_URL` is automatically configured
- The `.env` file is already excluded from git (in `.gitignore`) to protect your credentials
- If running the app outside Docker, uncomment the `DATABASE_URL` line in `.env`

---

### **4. Start the Application with Docker Compose**

The application is fully containerized using Docker Compose, which runs both the PostgreSQL database and the Node.js application in containers.

**Configuration Overview:**
The `docker-compose.yml` file includes:
- **Database service**: PostgreSQL with data stored in local `db_volume/` directory (using PostgreSQL 18+ recommended mount point)
- **App service**: Node.js application that automatically runs migrations on startup
- **Health checks**: Ensures database is ready before starting the app
- **Networking**: Both services communicate via a private Docker network

**To start the application:**
```bash
docker compose up -d
```

This command will:
1. Build the Node.js application Docker image
2. Start the PostgreSQL database container
3. Wait for the database to be healthy
4. Run database migrations automatically
5. Start the Node.js application

**To view logs:**
```bash
# View logs from both services
docker compose logs -f

# View logs from just the app
docker compose logs -f app

# View logs from just the database
docker compose logs -f db
```

**To stop the application:**
```bash
docker compose down
```

**To stop and remove database data:**
```bash
docker compose down
rm -rf db_volume/
```

**Note:** Database data is stored in `db_volume/` directory. PostgreSQL 18+ automatically creates subdirectories inside for version-specific data storage.

Visit the application at `http://localhost:8080`.

- **Homepage**: `http://localhost:8080/` - Shows connection status
- **Client Info API**: `http://localhost:8080/api/client-info` - Returns your IP, user-agent, and geolocation
- **Visit Logs**: `http://localhost:8080/logs` - Displays paginated table of all visits
- **Health Check**: `http://localhost:8080/_health` - GCP health monitoring endpoint

### **Alternative: Running Without Docker**

If you prefer to run the application directly on your machine (without Docker):

1. **Ensure Node.js 22+ is installed**
2. **Set up environment variables**: Uncomment the `DATABASE_URL` line in your `.env` file
3. **Start PostgreSQL** (using Docker or installed locally):
   ```bash
   docker compose up -d db  # Start only the database
   ```
4. **Install dependencies**:
   ```bash
   npm install
   ```
5. **Run migrations**:
   ```bash
   npm run migrate
   ```
6. **Start the app**:
   ```bash
   npm start
   ```

---

# **Client Info Database Sample App Deployment to the Google Cloud**

This guide details how to deploy the "Client Info Database Sample App" to **Google Cloud**, utilizing **App Engine**, **Cloud SQL**, and **Cloud Build**. This project captures visitor data and stores it in a PostgreSQL database.

---

## **1. Set Up Google Cloud Project**
1. Create a new project in the [Google Cloud Console](https://console.cloud.google.com/):
   - Click "Select a project" in the top bar.
   - Click "New Project" and follow the prompts.
2. Note your **Project ID** (e.g., `your-project-id`).
3. Set the project ID as the default for the `gcloud` CLI:
   ```bash
   gcloud config set project your-project-id
   ```
4. Enable billing for the project:
   - Navigate to the **Billing** section of your project.
   - Ensure billing is enabled.

---

## **2. Enable Required Services**
Enable the necessary APIs for your project:
```bash
gcloud services enable cloudbuild.googleapis.com
gcloud services enable appengine.googleapis.com
gcloud services enable sqladmin.googleapis.com
gcloud services enable secretmanager.googleapis.com
```

---

## **3. Set Up App Engine**
Initialize App Engine in your project:
```bash
gcloud app create --region=europe-west2
```
You can choose a different region if desired.

---

## **4. Set Up Cloud SQL**

### 4.1 Create Cloud SQL Instance
1. Create a PostgreSQL Cloud SQL instance with a **public IP**:
   ```bash
   gcloud sql instances create my-postgres-instance \
    --database-version=POSTGRES_17 \
    --region=europe-west2 \
    --authorized-networks=0.0.0.0/0 \
    --edition=ENTERPRISE \
    --tier=db-custom-1-3840 \
    --availability-type=ZONAL \
    --no-backup \
    --storage-size=10 \
    --storage-type=SSD \
    --no-storage-auto-increase \
    --maintenance-window-day=SUN \
    --maintenance-window-hour=4 \
    --maintenance-release-channel=production \
    --replication=asynchronous

   ```

Secure postgress default user:

**Note:** Replace `your_secure_password` with a secure password.

```bash
gcloud sql users set-password postgres \
    --instance=my-postgres-instance \
    --password=your_secure_password
```


2. Create a database:
   ```bash
   gcloud sql databases create client_info --instance=my-postgres-instance
   ```

3. Create a database user:
   ```bash
   gcloud sql users create secure_user \
       --instance=my-postgres-instance \
       --password=secure_password
   ```

---

## **5. Store Database URL in Secret Manager**

⚠️ **CRITICAL STEP** - Please follow these instructions carefully.

### 5.1 Get Your Cloud SQL Instance Connection Name

First, get the full connection name of your Cloud SQL instance:
```bash
gcloud sql instances describe my-postgres-instance --format="value(connectionName)"
```

This will output something like: `your-project-id:europe-west2:my-postgres-instance`

### 5.2 Create the DATABASE_URL Secret

Now create the `DATABASE_URL` secret, **replacing the placeholders** with your actual values:

```bash
echo -n "postgresql://secure_user:secure_password@/client_info?host=/cloudsql/YOUR_PROJECT_ID:REGION:INSTANCE_NAME" | \
gcloud secrets create DATABASE_URL --data-file=-
```

**Example with actual values:**
```bash
echo -n "postgresql://secure_user:secure_password@/client_info?host=/cloudsql/ip-info-db-478512:europe-west2:my-postgres-instance" | \
gcloud secrets create DATABASE_URL --data-file=-
```

**Important Notes:**
- ✅ Use the **exact** username and password you set in step 4.3 (`secure_user` / `secure_password`)
- ✅ Use the **full** connection name from step 5.1 (format: `PROJECT_ID:REGION:INSTANCE_NAME`)
- ❌ Do NOT use `<INSTANCE_CONNECTION_NAME>` literally - it's a placeholder!
- ❌ Do NOT add SSL configuration - Cloud SQL Unix socket handles encryption automatically

### 5.3 Verify the Secret

To verify the secret was created correctly:
```bash
gcloud secrets versions access latest --secret="DATABASE_URL"
```

You should see your full DATABASE_URL string (without `<INSTANCE_CONNECTION_NAME>` placeholder).

---

## **6. Grant Secret Manager Permissions**

Allow App Engine to access the `DATABASE_URL` secret:

```bash
gcloud secrets add-iam-policy-binding DATABASE_URL \
    --member="serviceAccount:<PROJECT_ID>@appspot.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
```

Replace `<PROJECT_ID>` with your Google Cloud project ID.
You can get list of projects by executing:
```bash
gcloud projects list
```
---

## **7. Configure `app.yaml`**

Review an `app.yaml` file in the project root:
```yaml
runtime: nodejs22
instance_class: F1
env: standard
automatic_scaling:
  target_cpu_utilization: 0.65
  target_throughput_utilization: 0.75
  max_instances: 2
env_variables:
  NODE_ENV: production
```

This configuration sets your application to run in production mode and allows automatic scaling based on traffic.

---

## **8. Configure `cloudbuild.yaml`**

Review and validate a `cloudbuild.yaml` file in the project root with the following content:

```yaml
steps:
  # Step 1: Install dependencies
  - name: 'node:22'
    entrypoint: 'npm'
    args: ['install']

  # Step 2: Run Sequelize migrations with DATABASE_URL fetched from Secret Manager
  - name: 'node:22'
    entrypoint: 'bash'
    args:
      - '-c'
      - |
        echo "Fetching DATABASE_URL from Secret Manager..."
        DATABASE_URL=$(gcloud secrets versions access latest --secret=DATABASE_URL)
        echo "Running migrations..."
        DATABASE_URL=$DATABASE_URL npx sequelize-cli db:migrate

  # Step 3: Deploy to Google App Engine
  - name: 'gcr.io/cloud-builders/gcloud'
    args: ['app', 'deploy', '--quiet']

options:
  logging: CLOUD_LOGGING_ONLY
timeout: '900s'

```

---

## **9. Deploy the Application**

You can deploy manualy using the following command, however it is recommended to use Cloud Build triggers for automatic deployment.:
```bash
gcloud app deploy
```

after that you can validate the deployment by executing:
```bash
gcloud app browse
```

Logs can be checked using the following command:
```bash
gcloud app logs tail -s default
```


### 9.1 Push Code to GitHub
The following instruction shows deployment using Cloud Build triggers. If you prefer manual deployment, skip this step.

1. Add a remote repository to your project:
   ```bash
   git remote add origin https://github.com/<YOUR_GITHUB_USERNAME>/<YOUR_REPOSITORY>.git
   ```
2. Push your code to GitHub:
   ```bash
   git add .
   git commit -m "Initial commit"
   git push -u origin main
   ```

### 9.2 Create a Cloud Build Trigger
Set up a trigger in Google Cloud to deploy your app on every commit:
```bash
gcloud beta builds triggers create github \
    --name="deploy-visit-logs-app" \
    --repo-name="<YOUR_REPOSITORY>" \
    --repo-owner="<YOUR_GITHUB_USERNAME>" \
    --branch-pattern=".*" \
    --build-config="cloudbuild.yaml"
```

Replace `<YOUR_REPOSITORY>` and `<YOUR_GITHUB_USERNAME>` with your repository details.

---

## **10. Test the Application**

1. Visit your application at:
   ```
   https://<YOUR_PROJECT_ID>.appspot.com
   ```
2. Check the visitor logs at:
   ```
   https://<YOUR_PROJECT_ID>.appspot.com/logs
   ```

---

## **11. Cleanup**

To avoid incurring unnecessary costs, clean up the resources:

Delete the project. First display list of projects:
 
   ```bash
   gcloud projects list
   ```
Then delete the project:
   ```bash
   gcloud projects delete <PROJECT_ID>
   ```
Replace `<PROJECT_ID>` with your project ID.


---

## **Additional Notes**

### **Geolocation API Limits**
This application uses the **ipapi.co** free service for geolocation data. Be aware of the following limits:
- **1,000 requests per day** without an API key
- **30,000 requests per month** total
- If these limits are exceeded, location data will display as "N/A"
- For localhost/development testing, location is automatically set to "N/A"
- For production use or higher limits, consider signing up for a free API key at [ipapi.co](https://ipapi.co/)

### **Security Features**
This application includes several security best practices for educational purposes:
- **Helmet.js**: Adds security headers to protect against common vulnerabilities (XSS, clickjacking, MIME sniffing, etc.)
- **Rate Limiting**: API endpoints are limited to 100 requests per IP address every 15 minutes to prevent abuse
- **Input Validation**: Query parameters (page, limit) are validated to prevent injection attacks
- **Content Security Policy**: Configured to allow Bootstrap CDN while maintaining security
- **Graceful Shutdown**: The app properly handles SIGTERM signals for clean shutdowns in cloud environments
- **Secure Cloud SQL Connection**: Uses Cloud SQL Unix socket for encrypted database connections (no SSL configuration needed)

### **Health Check Endpoint**
The application includes a health check endpoint at `/_health` that returns:
```json
{
  "status": "ok",
  "database": "connected",
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```
This endpoint:
- Checks database connectivity
- Returns 200 OK if database is connected
- Returns 503 Service Unavailable if database is disconnected
- Used by Google Cloud Platform for monitoring and health checks

### **Database Models**
This application uses **inline Sequelize models** defined directly in `app.js` (lines 44-54). The `models/index.js` file exists but is not used by the application. This is an intentional simplification for educational purposes. If you plan to expand this application with multiple models, consider using the standard Sequelize model structure via `models/index.js`.

---

## **Troubleshooting**

### **Issue: Location shows "N/A" for all visitors**
**Possible causes:**
1. The ipapi.co free tier limit (1,000 requests/day or 30,000/month) has been exceeded
2. The geolocation API is temporarily unavailable
3. The IP address is localhost or cannot be geolocated (e.g., private networks, VPNs)

**Solution:** Wait for the daily/monthly limit to reset, or sign up for a free API key at ipapi.co.

### **Issue: "Too many requests" error**
**Cause:** The rate limiter has detected more than 100 requests from your IP in 15 minutes.

**Solution:** Wait 15 minutes before trying again, or test from a different IP address.

### **Issue: App won't start locally**
**Cause:** Node.js version is too old (only applies if running outside Docker).

**Solution:** Upgrade to Node.js 22 or higher:
```bash
nvm install 22
nvm use 22
```
Or download from [nodejs.org](https://nodejs.org/).

### **Issue: "Cannot find .env file" or environment variables not loading**
**Cause:** The `.env` file hasn't been created from the template.

**Solution:**
```bash
cp .env.template .env
```
Then edit `.env` with your desired credentials if needed.

### **Issue: models/index.js references config.json instead of config.js**
**Note:** This has been fixed in the latest version (line 9 of models/index.js now correctly references config.js). If you encounter this error, update line 9 from `config.json` to `config.js`.

### **GCP Deployment: "Failed to initialize application: connect EIO /cloudsql/<INSTANCE_CONNECTION_NAME>"**

**Cause:** The DATABASE_URL secret contains the literal placeholder `<INSTANCE_CONNECTION_NAME>` instead of the actual Cloud SQL instance connection name.

**Solution:**
1. Get your instance connection name:
   ```bash
   gcloud sql instances describe my-postgres-instance --format="value(connectionName)"
   ```
2. Update the DATABASE_URL secret with the actual connection name:
   ```bash
   echo -n "postgresql://secure_user:secure_password@/client_info?host=/cloudsql/YOUR_ACTUAL_CONNECTION_NAME" | \
   gcloud secrets versions add DATABASE_URL --data-file=-
   ```
3. Redeploy the application:
   ```bash
   gcloud app deploy --quiet
   ```

### **GCP Deployment: "The server does not support SSL connections"**

**Cause:** The application code has SSL configuration enabled for Cloud SQL Unix socket connections (which don't support SSL).

**Solution:** This should not occur with the current version. Cloud SQL Unix socket connections handle encryption automatically via the Cloud SQL proxy and do not require SSL configuration in the application code. If you see this error, ensure your `app.js` Sequelize configuration does NOT include `dialectOptions` with SSL settings.

### **GCP Deployment: "password authentication failed for user 'secure_user'"**

**Cause:** The password in the DATABASE_URL secret doesn't match the actual Cloud SQL user password.

**Solution:**
1. Reset the Cloud SQL user password to match the DATABASE_URL:
   ```bash
   gcloud sql users set-password secure_user \
       --instance=my-postgres-instance \
       --password=secure_password
   ```
   OR update the DATABASE_URL secret with the correct password (use the exact same password from step 4.3)

2. Verify they match:
   ```bash
   gcloud secrets versions access latest --secret="DATABASE_URL"
   ```

### **Database Connection Issues**
- Verify the `DATABASE_URL` secret is correctly configured (no placeholders like `<INSTANCE_CONNECTION_NAME>`)
- Ensure the Cloud SQL instance has the correct user, password, and database
- Check Cloud SQL connection name matches the one in DATABASE_URL
- Verify username/password in DATABASE_URL matches the Cloud SQL user credentials

### **Permission Errors**
- Ensure the App Engine service account has the `roles/secretmanager.secretAccessor` role
- Verify the service account email format: `<PROJECT_ID>@appspot.gserviceaccount.com`
- Run the IAM binding command from step 6 if unsure

### **Deployment Failures**
- Check the Cloud Build logs in the Google Cloud Console for more details
- Verify migrations ran successfully during the Cloud Build step
- Check that all required APIs are enabled (App Engine, Cloud Build, Cloud SQL, Secret Manager)
- Check App Engine logs: `gcloud app logs read --limit=50`
