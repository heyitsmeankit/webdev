#!/bin/bash

################################################################################
# Quick Update Script - Pull latest changes and restart dashboard
################################################################################

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

APP_DIR="/opt/malware-dashboard"

echo -e "${BLUE}═══════════════════════════════════════════${NC}"
echo -e "${BLUE}     Malware Dashboard - Quick Update      ${NC}"
echo -e "${BLUE}═══════════════════════════════════════════${NC}"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}Please run as root: sudo bash update.sh${NC}"
    exit 1
fi

# Check if app directory exists
if [ ! -d "$APP_DIR" ]; then
    echo -e "${RED}Error: $APP_DIR not found${NC}"
    echo "Run deploy.sh first to install the dashboard"
    exit 1
fi

cd "$APP_DIR"

# Show current version
echo -e "${YELLOW}Current version:${NC}"
git log -1 --oneline
echo ""

# Pull latest changes
echo -e "${YELLOW}[1/4] Pulling latest changes from GitHub...${NC}"
sudo -u dashboard git pull origin main
echo -e "${GREEN}✓ Update complete${NC}"
echo ""

# Install any new dependencies
echo -e "${YELLOW}[2/4] Checking for new dependencies...${NC}"
npm install --production
echo -e "${GREEN}✓ Dependencies updated${NC}"
echo ""

# Restart service
echo -e "${YELLOW}[3/4] Restarting malware-dashboard service...${NC}"
systemctl restart malware-dashboard.service
sleep 2
echo -e "${GREEN}✓ Service restarted${NC}"
echo ""

# Check status
echo -e "${YELLOW}[4/4] Verifying service status...${NC}"
if systemctl is-active --quiet malware-dashboard.service; then
    echo -e "${GREEN}✓ Dashboard is running${NC}"
else
    echo -e "${RED}✗ Dashboard failed to start${NC}"
    echo "Check logs: sudo journalctl -u malware-dashboard.service -n 50"
    exit 1
fi
echo ""

# Show new version
echo -e "${YELLOW}New version:${NC}"
git log -1 --oneline
echo ""

echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}     Update completed successfully!        ${NC}"
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo ""
echo "Dashboard is now running the latest version"
echo ""
echo "View logs: sudo journalctl -u malware-dashboard.service -f"
echo "Check status: sudo systemctl status malware-dashboard.service"
echo ""
