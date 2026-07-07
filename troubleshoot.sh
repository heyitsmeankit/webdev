#!/bin/bash

################################################################################
# Malware Dashboard - Troubleshooting Script
################################################################################

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║       Malware Dashboard Troubleshooting Script              ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check 1: Service Status
echo -e "${YELLOW}[1] Checking service status...${NC}"
systemctl status malware-dashboard.service --no-pager -l
echo ""

# Check 2: Process Running
echo -e "${YELLOW}[2] Checking if Node.js process is running...${NC}"
ps aux | grep -E "node.*server.js" | grep -v grep
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Node.js process is running${NC}"
else
    echo -e "${RED}✗ Node.js process NOT running${NC}"
fi
echo ""

# Check 3: Port Listening
echo -e "${YELLOW}[3] Checking if port 3000 is listening...${NC}"
netstat -tlnp | grep :3000 || ss -tlnp | grep :3000
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Port 3000 is listening${NC}"
else
    echo -e "${RED}✗ Port 3000 is NOT listening${NC}"
fi
echo ""

# Check 4: Service Logs (last 30 lines)
echo -e "${YELLOW}[4] Recent service logs:${NC}"
journalctl -u malware-dashboard.service -n 30 --no-pager
echo ""

# Check 5: Application Directory
echo -e "${YELLOW}[5] Checking application files...${NC}"
if [ -f "/opt/malware-dashboard/server.js" ]; then
    echo -e "${GREEN}✓ server.js exists${NC}"
    ls -lh /opt/malware-dashboard/server.js
else
    echo -e "${RED}✗ server.js NOT FOUND${NC}"
fi
echo ""

# Check 6: Dependencies
echo -e "${YELLOW}[6] Checking node_modules...${NC}"
if [ -d "/opt/malware-dashboard/node_modules" ]; then
    echo -e "${GREEN}✓ node_modules directory exists${NC}"
    echo "Total packages: $(ls -1 /opt/malware-dashboard/node_modules | wc -l)"
else
    echo -e "${RED}✗ node_modules NOT FOUND${NC}"
fi
echo ""

# Check 7: Firewall Status
echo -e "${YELLOW}[7] Checking firewall rules...${NC}"
ufw status | grep 3000
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Firewall rule exists for port 3000${NC}"
else
    echo -e "${YELLOW}⚠ No specific firewall rule for port 3000${NC}"
fi
echo ""

# Check 8: Network Interfaces
echo -e "${YELLOW}[8] Network interfaces:${NC}"
ip addr show | grep inet
echo ""

# Check 9: Try local connection
echo -e "${YELLOW}[9] Testing local connection to port 3000...${NC}"
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" http://localhost:3000 --connect-timeout 5
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Local connection successful${NC}"
else
    echo -e "${RED}✗ Local connection failed${NC}"
fi
echo ""

# Check 10: Security Groups / Cloud Firewall
echo -e "${YELLOW}[10] Additional checks needed:${NC}"
echo "If running on cloud (AWS/Azure/GCP):"
echo "  • Check Security Groups allow inbound TCP port 3000"
echo "  • Check Network ACLs"
echo "  • Check if public IP is accessible"
echo ""

# Summary and Recommendations
echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                    RECOMMENDATIONS                           ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "Common fixes:"
echo ""
echo "1. Restart the service:"
echo "   sudo systemctl restart malware-dashboard.service"
echo ""
echo "2. Check if port is already in use:"
echo "   sudo lsof -i :3000"
echo ""
echo "3. Manually start to see errors:"
echo "   cd /opt/malware-dashboard && sudo -u dashboard node server.js"
echo ""
echo "4. Check cloud security groups (if on AWS/Azure/GCP):"
echo "   • AWS: EC2 → Security Groups → Inbound Rules"
echo "   • Azure: Network Security Groups"
echo "   • GCP: VPC Firewall Rules"
echo ""
echo "5. Allow through UFW firewall:"
echo "   sudo ufw allow 3000/tcp"
echo "   sudo ufw reload"
echo ""
echo "6. Disable firewall temporarily (for testing only):"
echo "   sudo ufw disable"
echo ""
echo "7. Check application errors:"
echo "   sudo journalctl -u malware-dashboard.service -f"
echo ""
