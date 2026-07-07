# Malware Analysis Dashboard - Deployment Guide

## Quick Start Deployment on Ubuntu

This dashboard monitors 4 active malware Firebase databases identified from APK analysis.

### Prerequisites
- Fresh Ubuntu 20.04 LTS or newer
- Root/sudo access
- Internet connection

### One-Command Deployment

```bash
# Download and run the deployment script
curl -fsSL https://raw.githubusercontent.com/heyitsmeankit/webdev/main/deploy.sh | sudo bash
```

**OR** if you've cloned the repository:

```bash
sudo bash deploy.sh
```

### What the Script Does

1. ✅ Updates system packages
2. ✅ Installs Node.js 18.x LTS and npm
3. ✅ Installs Git
4. ✅ Installs PM2 process manager
5. ✅ Creates a dedicated service user (`dashboard`)
6. ✅ Clones the repository to `/opt/malware-dashboard`
7. ✅ Installs all Node.js dependencies
8. ✅ Sets correct file permissions
9. ✅ Configures firewall (UFW) to allow port 3000
10. ✅ Creates and enables systemd service
11. ✅ Starts the dashboard service

### Post-Deployment

After successful deployment, access the dashboard at:
```
http://YOUR_SERVER_IP:3000
```

### Service Management

**Check Status:**
```bash
sudo systemctl status malware-dashboard.service
```

**View Live Logs:**
```bash
sudo journalctl -u malware-dashboard.service -f
```

**Restart Service:**
```bash
sudo systemctl restart malware-dashboard.service
```

**Stop Service:**
```bash
sudo systemctl stop malware-dashboard.service
```

**Start Service:**
```bash
sudo systemctl start malware-dashboard.service
```

**Enable Auto-Start on Boot:**
```bash
sudo systemctl enable malware-dashboard.service
```

### Monitored Firebase Databases

The dashboard monitors these 4 malware Firebase databases:

| ID | Firebase URL | Source APK | Schema |
|----|--------------|------------|--------|
| 1 | `colana-84ce2-default-rtdb.firebaseio.com` | my hr5.apk | Schema 1 |
| 2 | `sirelech1-default-rtdb.firebaseio.com` | hr1.apk | Schema 2 |
| 3 | `vish-4a6de-default-rtdb.firebaseio.com` | hr2.apk | Schema 2 |
| 4 | `gggggg-979bd-default-rtdb.firebaseio.com` | hr3.apk | Schema 1 |

### Dashboard Features

- **📡 Malware Databases (4)**: Monitor all 4 Firebase databases with real-time device data
- **🔍 Edit Keywords**: Configure alert keywords for suspicious activity
- **🚨 On Alert Devices**: View devices that triggered keyword alerts
- **📊 Find All**: Search and filter across all monitored devices

### Manual Deployment (Advanced)

If you prefer manual installation:

```bash
# 1. Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo bash -
sudo apt-get install -y nodejs

# 2. Clone repository
sudo git clone https://github.com/heyitsmeankit/webdev.git /opt/malware-dashboard

# 3. Install dependencies
cd /opt/malware-dashboard
sudo npm install --production

# 4. Start with PM2
sudo npm install -g pm2
sudo pm2 start server.js --name malware-dashboard
sudo pm2 startup systemd
sudo pm2 save
```

### Troubleshooting

**Port Already in Use:**
```bash
# Check what's using port 3000
sudo lsof -i :3000

# Kill the process if needed
sudo kill -9 <PID>

# Or change the port in server.js
```

**Service Won't Start:**
```bash
# Check detailed logs
sudo journalctl -u malware-dashboard.service -n 50 --no-pager

# Check Node.js errors
sudo -u dashboard node /opt/malware-dashboard/server.js
```

**Firewall Issues:**
```bash
# Check firewall status
sudo ufw status

# Allow port 3000
sudo ufw allow 3000/tcp

# Or disable firewall (not recommended for production)
sudo ufw disable
```

**Dependencies Missing:**
```bash
cd /opt/malware-dashboard
sudo npm install
```

### Security Notes

⚠️ **Important Security Considerations:**

1. **Firewall**: Ensure proper firewall rules are in place
2. **Network**: Consider using a reverse proxy (nginx/apache) for HTTPS
3. **Access Control**: This dashboard has no authentication - implement access controls if exposed to internet
4. **Monitoring**: These are LIVE malware databases - handle data carefully
5. **Updates**: Regularly update the system and dependencies

### Updating the Dashboard

```bash
cd /opt/malware-dashboard
sudo -u dashboard git pull origin main
sudo npm install
sudo systemctl restart malware-dashboard.service
```

### Uninstallation

```bash
# Stop and disable service
sudo systemctl stop malware-dashboard.service
sudo systemctl disable malware-dashboard.service
sudo rm /etc/systemd/system/malware-dashboard.service
sudo systemctl daemon-reload

# Remove files
sudo rm -rf /opt/malware-dashboard

# Remove user (optional)
sudo userdel -r dashboard

# Remove firewall rule
sudo ufw delete allow 3000/tcp
```

### Production Recommendations

For production deployment, consider:

1. **Reverse Proxy**: Use nginx with HTTPS
   ```nginx
   server {
       listen 80;
       server_name your-domain.com;
       
       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```

2. **SSL/TLS**: Use Let's Encrypt for free SSL certificates
   ```bash
   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx -d your-domain.com
   ```

3. **Monitoring**: Set up system monitoring (netdata, grafana, etc.)

4. **Backups**: Regular backups of `/opt/malware-dashboard/data/`

5. **Log Rotation**: Configure logrotate for application logs

### Support

For issues or questions:
- Check logs: `sudo journalctl -u malware-dashboard.service -f`
- Repository: https://github.com/heyitsmeankit/webdev
- Review the source code in `/opt/malware-dashboard/`

---

**Dashboard Version**: 1.0  
**Last Updated**: 2024  
**Deployment Target**: Ubuntu 20.04+ LTS
