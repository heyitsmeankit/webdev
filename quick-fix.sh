#!/bin/bash

################################################################################
# Quick Fix Script - Common Dashboard Issues
################################################################################

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}Starting quick fix procedure...${NC}"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}Please run as root: sudo bash quick-fix.sh${NC}"
    exit 1
fi

# Fix 1: Ensure UFW allows port 3000
echo -e "${YELLOW}[1] Ensuring firewall allows port 3000...${NC}"
ufw allow 3000/tcp
echo -e "${GREEN}✓ Firewall rule added/updated${NC}"
echo ""

# Fix 2: Check if something else is using port 3000
echo -e "${YELLOW}[2] Checking if port 3000 is available...${NC}"
if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null ; then
    echo -e "${YELLOW}Port 3000 is in use. Checking by what...${NC}"
    lsof -i :3000
    echo ""
    echo -e "${YELLOW}Stopping malware-dashboard service...${NC}"
    systemctl stop malware-dashboard.service
    sleep 2
else
    echo -e "${GREEN}✓ Port 3000 is available${NC}"
fi
echo ""

# Fix 3: Verify server.js exists and has correct permissions
echo -e "${YELLOW}[3] Checking application files...${NC}"
if [ ! -f "/opt/malware-dashboard/server.js" ]; then
    echo -e "${RED}server.js not found! Re-cloning repository...${NC}"
    rm -rf /opt/malware-dashboard
    git clone https://github.com/heyitsmeankit/webdev.git /opt/malware-dashboard
    cd /opt/malware-dashboard
    npm install --production
fi
chown -R dashboard:dashboard /opt/malware-dashboard
echo -e "${GREEN}✓ Files verified and permissions set${NC}"
echo ""

# Fix 4: Reinstall dependencies
echo -e "${YELLOW}[4] Reinstalling Node.js dependencies...${NC}"
cd /opt/malware-dashboard
npm install --production
echo -e "${GREEN}✓ Dependencies installed${NC}"
echo ""

# Fix 5: Restart the service
echo -e "${YELLOW}[5] Restarting malware-dashboard service...${NC}"
systemctl daemon-reload
systemctl restart malware-dashboard.service
sleep 3
echo -e "${GREEN}✓ Service restarted${NC}"
echo ""

# Fix 6: Check service status
echo -e "${YELLOW}[6] Checking service status...${NC}"
if systemctl is-active --quiet malware-dashboard.service; then
    echo -e "${GREEN}✓ Service is ACTIVE${NC}"
else
    echo -e "${RED}✗ Service is NOT active${NC}"
    echo "Showing service status:"
    systemctl status malware-dashboard.service --no-pager
    exit 1
fi
echo ""

# Fix 7: Test local connection
echo -e "${YELLOW}[7] Testing local connection...${NC}"
sleep 2
response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 --connect-timeout 5)
if [ "$response" == "200" ] || [ "$response" == "301" ] || [ "$response" == "302" ]; then
    echo -e "${GREEN}✓ Dashboard responding on localhost (HTTP $response)${NC}"
else
    echo -e "${RED}✗ Dashboard not responding locally (HTTP $response)${NC}"
    echo "Checking application logs:"
    journalctl -u malware-dashboard.service -n 20 --no-pager
fi
echo ""

# Fix 8: Display access information
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}        QUICK FIX COMPLETED${NC}"
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}Dashboard should be accessible at:${NC}"
echo "  • Local: http://localhost:3000"
echo "  • Network: http://$(hostname -I | awk '{print $1}'):3000"
echo ""
echo -e "${YELLOW}If still not reachable from external network:${NC}"
echo ""
echo "1. Check cloud security groups (AWS/Azure/GCP):"
echo "   - AWS EC2: Add inbound rule for TCP port 3000"
echo "   - Azure: Configure Network Security Group"
echo "   - GCP: Add firewall rule for tcp:3000"
echo ""
echo "2. Check if you're using the correct IP:"
echo "   - Private IP (172.x.x.x): Only works within VPC"
echo "   - Public IP: Required for external access"
echo ""
echo "3. Verify service is running:"
echo "   sudo systemctl status malware-dashboard.service"
echo ""
echo "4. Check live logs:"
echo "   sudo journalctl -u malware-dashboard.service -f"
echo ""
echo "5. Test from the server itself:"
echo "   curl http://localhost:3000"
echo ""
