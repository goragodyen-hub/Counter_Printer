import http.server
import socketserver
import json
import socket
import subprocess
import os
import urllib.parse
import sys
import datetime
import time
import threading
import urllib.request

# Configure stdout to use UTF-8
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

PORT = 3000
GSHEETS_URL = 'https://script.google.com/macros/s/AKfycbxVSZF5bn4T_mNy_lejv3Jh0r77lBDE0FsWdeE_jGNyw0qv4TIPvgnnpwBKE2dEU1uH/exec'

# Resolve the application directory path whether running as Python script or packaged .exe
if getattr(sys, 'frozen', False):
    BASE_DIR = os.path.dirname(sys.executable)
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ─── Daily Auto Scheduler & Logging System ───────────────────────────────────

def save_record_to_gsheets(month, entries):
    if not GSHEETS_URL:
        return False
    data = {
        "action": "saveRecords",
        "month": month,
        "entries": entries
    }
    req_data = json.dumps(data).encode('utf-8')
    req = urllib.request.Request(
        GSHEETS_URL,
        data=req_data,
        headers={'Content-Type': 'application/json'}
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            res_body = response.read().decode('utf-8')
            res_json = json.loads(res_body)
            return res_json.get("success", False)
    except Exception as e:
        print(f"⚠️ Error syncing to Google Sheets: {str(e)}")
        return False

def get_daily_status():
    status_path = os.path.join(BASE_DIR, "data", "daily_status.json")
    os.makedirs(os.path.dirname(status_path), exist_ok=True)
    
    today_str = datetime.date.today().isoformat()
    
    if os.path.exists(status_path):
        try:
            with open(status_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if data.get("date") == today_str:
                    return data
        except:
            pass
            
    return {
        "date": today_str,
        "scanned_printers": {},
        "hours_scanned": []
    }
    
def save_daily_status(status):
    status_path = os.path.join(BASE_DIR, "data", "daily_status.json")
    os.makedirs(os.path.dirname(status_path), exist_ok=True)
    try:
        with open(status_path, "w", encoding="utf-8") as f:
            json.dump(status, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"⚠️ Error saving daily_status.json: {str(e)}")

def log_to_csv(timestamp_str, pid, location, zone, ptype, bw, color, method):
    csv_path = os.path.join(BASE_DIR, "data", "daily_counters.csv")
    os.makedirs(os.path.dirname(csv_path), exist_ok=True)
    
    write_header = not os.path.exists(csv_path) or os.path.getsize(csv_path) == 0
    
    try:
        with open(csv_path, "a", encoding="utf-8-sig") as f:
            if write_header:
                f.write("Timestamp,PrinterID,Location,Zone,Type,BW_Counter,Color_Counter,ScanMethod\n")
            loc_esc = f'"{location}"' if ',' in location else location
            f.write(f"{timestamp_str},{pid},{loc_esc},{zone},{ptype},{bw},{color},{method}\n")
    except Exception as e:
        print(f"⚠️ Error writing to daily_counters.csv: {str(e)}")

def is_m_c251fwb(p):
    serial = str(p.get("serial", "")).upper()
    location = str(p.get("location", ""))
    return (
        "58:38:79:65:B7:52" in serial or 
        "58:38:79:65:68:FB" in serial or 
        "5823P700770" in serial or 
        "5823PA00137" in serial or
        "เครื่องสีเล็ก" in location or
        "M C251" in location
    )

def run_daily_scheduler():
    print("⏰ Daily Hourly Printer Scanner Scheduler Thread started successfully.")
    
    while True:
        try:
            now = datetime.datetime.now()
            current_hour = now.hour
            
            # Only check between 09:00 and 17:00
            if 9 <= current_hour <= 17:
                daily_status = get_daily_status()
                
                if "hours_scanned" not in daily_status:
                    daily_status["hours_scanned"] = []
                    
                if current_hour not in daily_status["hours_scanned"]:
                    print(f"⚡ Daily Hourly Scheduler: Starting scan for hour {current_hour:02d}:00")
                    
                    daily_status["hours_scanned"].append(current_hour)
                    save_daily_status(daily_status)
                    
                    printers_path = os.path.join(BASE_DIR, "data", "printers.json")
                    if os.path.exists(printers_path):
                        with open(printers_path, "r", encoding="utf-8") as f:
                            p_data = json.load(f)
                            printers = p_data.get("printers", [])
                    else:
                        printers = []
                        
                    scanned_printers = daily_status.get("scanned_printers", {})
                    pending_printers = [p for p in printers if p["id"] not in scanned_printers]
                    
                    if pending_printers:
                        print(f"🔍 Found {len(pending_printers)} printers pending scan today.")
                        newly_scanned_entries = []
                        now_str = now.strftime("%Y-%m-%d %H:%M:%S")
                        month_str = now.strftime("%Y-%m")
                        
                        threads = []
                        scan_results = []
                        lock = threading.Lock()
                        
                        def scan_worker(p):
                            ip = p.get("ip")
                            pid = p.get("id")
                            ptype = p.get("type")
                            if not ip:
                                return
                                
                            online = ping_ip(ip)
                            if online:
                                if is_m_c251fwb(p):
                                    bw = query_printer_counter(ip, "1.3.6.1.4.1.367.3.2.1.2.19.5.1.9.3")
                                    color = query_printer_counter(ip, "1.3.6.1.4.1.367.3.2.1.2.19.5.1.9.4")
                                else:
                                    total = query_printer_counter(ip, "1.3.6.1.2.1.43.10.2.1.4.1.1")
                                    if total is None:
                                        total = query_printer_counter(ip, "1.3.6.1.4.1.367.3.2.1.2.19.1.0")
                                        
                                    bw = query_printer_counter(ip, "1.3.6.1.4.1.367.3.2.1.2.19.2.0")
                                    color = query_printer_counter(ip, "1.3.6.1.4.1.367.3.2.1.2.19.4.0")
                                    
                                    if bw is None and total is not None:
                                        bw = total
                                    if color is None and ptype == "ขาวดำ":
                                        color = 0
                                    
                                if bw is not None:
                                    with lock:
                                        scan_results.append({
                                            "printer": p,
                                            "bw": bw,
                                            "color": color if color is not None else 0
                                        })
                                        
                        for p in pending_printers:
                            t = threading.Thread(target=scan_worker, args=(p,))
                            threads.append(t)
                            t.start()
                            
                        for t in threads:
                            t.join()
                            
                        if scan_results:
                            for res in scan_results:
                                p = res["printer"]
                                pid = p["id"]
                                bw = res["bw"]
                                color = res["color"]
                                
                                log_to_csv(now_str, pid, p["location"], p["zone"], p["type"], bw, color, f"Auto Scan ({current_hour:02d}:00)")
                                
                                newly_scanned_entries.append({
                                    "printerId": pid,
                                    "counterBW": bw,
                                    "counterColor": color,
                                    "note": f"Auto Scan ({current_hour:02d}:00)"
                                })
                                
                                scanned_printers[pid] = now_str
                                
                            daily_status["scanned_printers"] = scanned_printers
                            save_daily_status(daily_status)
                            
                            if newly_scanned_entries:
                                print(f"☁️ Syncing {len(newly_scanned_entries)} daily records to Google Sheets...")
                                success = save_record_to_gsheets(month_str, newly_scanned_entries)
                                if success:
                                    print("✅ Synced successfully to Google Sheets!")
                                else:
                                    print("⚠️ Google Sheets sync failed, will remain in local CSV log.")
                                    
                        print(f"⏰ Hourly Scan completed. Scanned successfully: {len(scan_results)} printers.")
                    else:
                        print("✅ All printers have already been successfully scanned today.")
                        
        except Exception as e:
            print(f"⚠️ Error in daily scheduler thread: {str(e)}")
            
        time.sleep(30)

# Helper to ping an IP quickly
def ping_ip(ip):
    try:
        # Ping with 1 packet, timeout 300ms
        if os.name == 'nt':
            res = subprocess.run(["ping", "-n", "1", "-w", "300", ip], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        else:
            res = subprocess.run(["ping", "-c", "1", "-W", "1", ip], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return res.returncode == 0
    except:
        return False

# ASN.1 BER SNMP helper
def build_snmp_get(community, oid_str):
    oid_parts = [int(x) for x in oid_str.split('.') if x != '']
    if oid_parts[0] == 1 and oid_parts[1] == 3:
        encoded_oid = bytearray([43])
        oid_parts = oid_parts[2:]
    else:
        encoded_oid = bytearray()
        
    for part in oid_parts:
        if part < 128:
            encoded_oid.append(part)
        else:
            bytes_list = []
            val = part
            bytes_list.append(val & 0x7f)
            val >>= 7
            while val > 0:
                bytes_list.append((val & 0x7f) | 0x80)
                val >>= 7
            encoded_oid.extend(reversed(bytes_list))
            
    varbind = bytearray([0x06, len(encoded_oid)]) + encoded_oid + bytearray([0x05, 0x00])
    varbind_list = bytearray([0x30, len(varbind)]) + varbind
    varbind_list_seq = bytearray([0x30, len(varbind_list)]) + varbind_list
    
    request_id = bytearray([0x02, 0x04, 0x01, 0x02, 0x03, 0x04])
    error_status = bytearray([0x02, 0x01, 0x00])
    error_index = bytearray([0x02, 0x01, 0x00])
    pdu = bytearray([0xa0, len(request_id) + len(error_status) + len(error_index) + len(varbind_list_seq)])
    pdu.extend(request_id)
    pdu.extend(error_status)
    pdu.extend(error_index)
    pdu.extend(varbind_list_seq)
    
    version = bytearray([0x02, 0x01, 0x01])
    comm = bytearray([0x04, len(community)]) + community.encode('utf-8')
    packet = bytearray([0x30, len(version) + len(comm) + len(pdu)])
    packet.extend(version)
    packet.extend(comm)
    packet.extend(pdu)
    return packet

def parse_snmp_response(response):
    if not response or len(response) < 10:
        return None
    for i in range(len(response) - 3, 0, -1):
        tag = response[i]
        length = response[i+1]
        if tag in [0x02, 0x41] and i + 2 + length == len(response):
            val = 0
            for b in response[i+2 : i+2+length]:
                val = (val << 8) | b
            return val
    return None

def query_printer_counter(ip, oid):
    packet = build_snmp_get("public", oid)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(0.5)
    try:
        sock.sendto(packet, (ip, 161))
        data, addr = sock.recvfrom(2048)
        val = parse_snmp_response(data)
        return val
    except:
        return None

class LocalServiceHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # API endpoint for Realtime Printer SNMP Scan
        parsed_url = urllib.parse.urlparse(self.path)
        if parsed_url.path == '/api/scan-realtime':
            self.handle_scan_realtime()
        else:
            # Fall back to serving static files
            super().do_GET()
            
    def handle_scan_realtime(self):
        printers_path = os.path.join(BASE_DIR, "data", "printers.json")
        try:
            with open(printers_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                printers = data.get("printers", [])
        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"success": False, "error": f"Failed to load printers.json: {str(e)}"}).encode('utf-8'))
            return

        results = {}
        for p in printers:
            ip = p.get("ip")
            pid = p.get("id")
            ptype = p.get("type")
            
            if not ip:
                continue
                
            online = ping_ip(ip)
            if not online:
                continue
                
            # Query SNMP counters
            if is_m_c251fwb(p):
                bw = query_printer_counter(ip, "1.3.6.1.4.1.367.3.2.1.2.19.5.1.9.3")
                color = query_printer_counter(ip, "1.3.6.1.4.1.367.3.2.1.2.19.5.1.9.4")
            else:
                total = query_printer_counter(ip, "1.3.6.1.2.1.43.10.2.1.4.1.1")
                if total is None:
                    total = query_printer_counter(ip, "1.3.6.1.4.1.367.3.2.1.2.19.1.0")
                    
                bw = query_printer_counter(ip, "1.3.6.1.4.1.367.3.2.1.2.19.2.0")
                color = query_printer_counter(ip, "1.3.6.1.4.1.367.3.2.1.2.19.4.0")
                
                if total is not None and bw is None:
                    if ptype == "ขาวดำ":
                        bw = total
                        color = 0

            if bw is not None or color is not None:
                results[pid] = {
                    "printerId": pid,
                    "counterBW": bw if bw is not None else 0,
                    "counterColor": color if color is not None else 0,
                    "success": True
                }

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps({"success": True, "results": results}, ensure_ascii=False).encode('utf-8'))

# Run server
if __name__ == "__main__":
    os.chdir(BASE_DIR)
    handler = LocalServiceHandler

    # Run daily scheduler in a background daemon thread
    scheduler_thread = threading.Thread(target=run_daily_scheduler, daemon=True)
    scheduler_thread.start()

    with socketserver.TCPServer(("", PORT), handler) as httpd:
        print(f"🚀 Custom Printer Dashboard Server running at http://localhost:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopping server...")
            httpd.shutdown()
