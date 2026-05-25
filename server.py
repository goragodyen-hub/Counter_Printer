import http.server
import socketserver
import json
import socket
import subprocess
import os
import urllib.parse
import sys

# Configure stdout to use UTF-8
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

PORT = 3000

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
        printers_path = os.path.join(os.path.dirname(__file__), "data", "printers.json")
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
            total = query_printer_counter(ip, "1.3.6.1.2.1.43.10.2.1.4.1.1")
            if total is None:
                total = query_printer_counter(ip, "1.3.6.1.4.1.367.3.2.1.2.19.1.0")
                
            bw = query_printer_counter(ip, "1.3.6.1.4.1.367.3.2.1.2.19.2.0")
            color = query_printer_counter(ip, "1.3.6.1.4.1.367.3.2.1.2.19.4.0")
            
            if total is not None and bw is None:
                if ptype == "ขาวดำ":
                    bw = total
                    color = 0

            if total is not None or bw is not None or color is not None:
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
os.chdir(os.path.dirname(os.path.abspath(__file__)))
handler = LocalServiceHandler
with socketserver.TCPServer(("", PORT), handler) as httpd:
    print(f"🚀 Custom Printer Dashboard Server running at http://localhost:{PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
        httpd.shutdown()
