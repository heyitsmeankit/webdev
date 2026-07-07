#!/bin/bash

################################################################################
# Malware Analysis Dashboard - Ubuntu Deployment Script
################################################################################
# This script deploys the web-dashboard on a fresh Ubuntu instance
# Usage: sudo bash deploy.sh
################################################################################

set -e  # Exit on any error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_DIR="/opt/malware-dashboard"
SERVICE_USER="dashboard"
REPO_URL="https://github.com/heyitsmeankit/webdev.git"
APP_PORT=3000

################################################################################
# Helper Functions
################################################################################

print_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

check_root() {
    if [ "$EUID" -ne 0 ]; then 
        print_error "Please run as root (use sudo)"
        exit 1
    fi
}

################################################################################
# Main Deployment Steps
################################################################################

print_step "Starting deployment of Malware Analysis Dashboard..."
echo ""

# Check if running as root
check_root

# Step 1: Update system
print_step "Updating system packages..."
apt-get update -y
apt-get upgrade -y
print_success "System updated"
echo ""

# Step 2: Install Node.js and npm
print_step "Installing Node.js and npm..."
if ! command -v node &> /dev/null; then
    # Install Node.js 18.x LTS
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
    print_success "Node.js $(node -v) installed"
    print_success "npm $(npm -v) installed"
else
    print_warning "Node.js $(node -v) already installed"
fi
echo ""

# Step 3: Install Git
print_step "Installing Git..."
if ! command -v git &> /dev/null; then
    apt-get install -y git
    print_success "Git installed"
else
    print_warning "Git $(git --version) already installed"
fi
echo ""

# Step 4: Install PM2 (process manager)
print_step "Installing PM2 process manager..."
if ! command -v pm2 &> /dev/null; then
    npm install -g pm2
    print_success "PM2 installed"
else
    print_warning "PM2 already installed"
fi
echo ""

# Step 5: Create service user
print_step "Creating service user '$SERVICE_USER'..."
if ! id "$SERVICE_USER" &>/dev/null; then
    useradd -r -m -s /bin/bash "$SERVICE_USER"
    print_success "User '$SERVICE_USER' created"
else
    print_warning "User '$SERVICE_USER' already exists"
fi
echo ""

# Step 6: Clone repository
print_step "Cloning repository from $REPO_URL..."
if [ -d "$APP_DIR" ]; then
    print_warning "Directory $APP_DIR already exists. Removing..."
    rm -rf "$APP_DIR"
fi

mkdir -p "$APP_DIR"
git clone "$REPO_URL" "$APP_DIR"
print_success "Repository cloned to $APP_DIR"
echo ""

# Step 7: Install dependencies
print_step "Installing Node.js dependencies..."
cd "$APP_DIR"
npm install --production
print_success "Dependencies installed"
echo ""

# Step 8: Set correct permissions
print_step "Setting file permissions..."
chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR"
chmod -R 755 "$APP_DIR"
print_success "Permissions set"
echo ""

# Step 9: Configure firewall (if ufw is available)
print_step "Configuring firewall..."
if command -v ufw &> /dev/null; then
    ufw allow "$APP_PORT"/tcp
    print_success "Firewall rule added for port $APP_PORT"
else
    print_warning "UFW not installed, skipping firewall configuration"
fi
echo ""

# Step 10: Create systemd service
print_step "Creating systemd service..."
cat > /etc/systemd/system/malware-dashboard.service <<EOF
[Unit]
Description=Malware Analysis Dashboard
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node $APP_DIR/server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=malware-dashboard
Environment=NODE_ENV=production
Environment=PORT=$APP_PORT

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable malware-dashboard.service
print_success "Systemd service created and enabled"
echo ""

# Step 11: Start the service
print_step "Starting Malware Analysis Dashboard..."
systemctl start malware-dashboard.service
sleep 3

# Check if service is running
if systemctl is-active --quiet malware-dashboard.service; then
    print_success "Dashboard is running!"
else
    print_error "Dashboard failed to start. Check logs with: journalctl -u malware-dashboard.service -f"
    exit 1
fi
echo ""

# Step 12: Display deployment information
print_success "======================================"
print_success "   DEPLOYMENT COMPLETED SUCCESSFULLY"
print_success "======================================"
echo ""
echo -e "${GREEN}Dashboard URL:${NC} http://$(hostname -I | awk '{print $1}'):$APP_PORT"
echo -e "${GREEN}Installation Directory:${NC} $APP_DIR"
echo -e "${GREEN}Service User:${NC} $SERVICE_USER"
echo -e "${GREEN}Service Name:${NC} malware-dashboard.service"
echo ""
echo -e "${BLUE}Useful Commands:${NC}"
echo "  Check status:    systemctl status malware-dashboard.service"
echo "  View logs:       journalctl -u malware-dashboard.service -f"
echo "  Restart:         systemctl restart malware-dashboard.service"
echo "  Stop:            systemctl stop malware-dashboard.service"
echo "  Start:           systemctl start malware-dashboard.service"
echo ""
echo -e "${YELLOW}Monitored Firebase Databases:${NC}"
echo "  1. colana-84ce2-default-rtdb.firebaseio.com (my hr5.apk)"
echo "  2. sirelech1-default-rtdb.firebaseio.com (hr1.apk)"
echo "  3. vish-4a6de-default-rtdb.firebaseio.com (hr2.apk)"
echo "  4. gggggg-979bd-default-rtdb.firebaseio.com (hr3.apk)"
echo ""
print_success "Access the dashboard now at: http://$(hostname -I | awk '{print $1}'):$APP_PORT"
