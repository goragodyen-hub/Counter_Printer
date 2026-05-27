import tkinter as tk
from tkinter import ttk
from tkinter import messagebox
import json
import os
import sys
import socket
import subprocess
import threading
import time
import datetime
import urllib.request

# Configure stdout to use UTF-8
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# ─── Resolve Base Directory (PyInstaller Safe) ────────────────────────────────
if getattr(sys, 'frozen', False):
    BASE_DIR = os.path.dirname(sys.executable)
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

PORT = 3000
GSHEETS_URL = 'https://script.google.com/macros/s/AKfycbxVSZF5bn4T_mNy_lejv3Jh0r77lBDE0FsWdeE_jGNyw0qv4TIPvgnnpwBKE2dEU1uH/exec'

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

def run_daily_scheduler(app_instance=None):
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
                                if ptype == "ขาวดำ":
                                    total = query_printer_counter(ip, "1.3.6.1.2.1.43.10.2.1.4.1.1")
                                    if total is None:
                                        total = query_printer_counter(ip, "1.3.6.1.4.1.367.3.2.1.2.19.1.0")
                                    bw = total
                                    color = 0
                                else:  # ptype == "สี"
                                    # 1. Try standard Ricoh B&W and Color OIDs
                                    bw = query_printer_counter(ip, "1.3.6.1.4.1.367.3.2.1.2.19.5.1.9.3")
                                    color = query_printer_counter(ip, "1.3.6.1.4.1.367.3.2.1.2.19.5.1.9.4")
                                    
                                    # 2. Try alternative Ricoh B&W and Color OIDs
                                    if bw is None or color is None:
                                        bw_alt = query_printer_counter(ip, "1.3.6.1.4.1.367.3.2.1.2.19.5.1.9.22")
                                        color_alt = query_printer_counter(ip, "1.3.6.1.4.1.367.3.2.1.2.19.5.1.9.21")
                                        if bw_alt is not None:
                                            bw = bw_alt
                                        if color_alt is not None:
                                            color = color_alt
                                            
                                    # 3. Fallback to Total Engine Counter if still missing
                                    if bw is None or color is None:
                                        total = query_printer_counter(ip, "1.3.6.1.2.1.43.10.2.1.4.1.1")
                                        if total is None:
                                            total = query_printer_counter(ip, "1.3.6.1.4.1.367.3.2.1.2.19.1.0")
                                        
                                        if total is not None:
                                            if bw is not None:
                                                color = total - bw
                                            elif color is not None:
                                                bw = total - color
                                            else:
                                                bw = total
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
                                
                                # Update active GUI cache if running inside Tkinter App
                                if app_instance:
                                    app_instance.printer_data_cache[pid] = {
                                        "online": True,
                                        "bw": bw,
                                        "color": color,
                                        "latency": 0.05
                                    }
                                
                            daily_status["scanned_printers"] = scanned_printers
                            save_daily_status(daily_status)
                            
                            # Refresh GUI if running inside Tkinter App
                            if app_instance:
                                app_instance.after(0, app_instance.render_stats)
                                app_instance.after(0, app_instance.render_grid)
                            
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

# ─── SNMP & Network Helpers ───────────────────────────────────────────────────

def ping_ip(ip):
    try:
        if os.name == 'nt':
            # Windows: ping with 1 packet, timeout 300ms
            res = subprocess.run(["ping", "-n", "1", "-w", "300", ip], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        else:
            # POSIX: ping with 1 packet, timeout 1s
            res = subprocess.run(["ping", "-c", "1", "-W", "1", ip], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return res.returncode == 0
    except:
        return False

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
    
    version = bytearray([0x02, 0x01, 0x01]) # SNMP v2c (value 1)
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
    sock.settimeout(0.4) # Timeout 400ms for SNMP response
    try:
        sock.sendto(packet, (ip, 161))
        data, addr = sock.recvfrom(2048)
        val = parse_snmp_response(data)
        return val
    except:
        return None

# ─── UI Constant Styling ──────────────────────────────────────────────────────
BG_MAIN     = "#0f172a"  # Slate 900
BG_CARD     = "#1e293b"  # Slate 800
BG_HEADER   = "#111827"  # Gray 900
TEXT_WHITE  = "#f8fafc"  # Slate 50
TEXT_GRAY   = "#94a3b8"  # Slate 400
ACCENT      = "#7c3aed"  # Violet 600
ACCENT_HOVER= "#6d28d9"  # Violet 700
ONLINE_COLOR= "#10b981"  # Emerald 500
OFFLINE_COLOR= "#ef4444" # Red 500
BW_COLOR    = "#e2e8f0"  # Slate 200
COLOR_COLOR = "#c084fc"  # Purple 400

ZONE_COLORS = {
    'มัธยม':         '#a855f7',
    'ประถม':         '#06b6d4',
    'อนุบาล':        '#10b981',
    'ห้องปฏิบัติการ': '#f59e0b',
}

class AutoScrollbar(ttk.Scrollbar):
    def set(self, lo, hi):
        if float(lo) <= 0.0 and float(hi) >= 1.0:
            self.grid_remove()
        else:
            self.grid()
        ttk.Scrollbar.set(self, lo, hi)

class PrinterMonitorApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("🖨️ ระบบตรวจสอบยอดพิมพ์เครื่องพิมพ์แบบเรียลไทม์")
        self.geometry("1100x750")
        self.minsize(900, 600)
        self.configure(bg=BG_MAIN)
        
        # Load custom fonts or set standard fonts
        self.font_title = ("Segoe UI", 16, "bold")
        self.font_header = ("Segoe UI", 12, "bold")
        self.font_body = ("Segoe UI", 10)
        self.font_bold = ("Segoe UI", 10, "bold")
        self.font_mono = ("Consolas", 9)
        self.font_badge = ("Segoe UI", 8, "bold")
        self.font_stat_num = ("Segoe UI", 20, "bold")
        
        self.printers = []
        self.printer_data_cache = {}  # pid -> { "online": bool, "bw": int/str, "color": int/str, "latency": float }
        self.active_zone = "ทั้งหมด"
        self.is_scanning = False
        
        self.setup_styles()
        self.create_widgets()
        self.load_printers()
        
        # Initial scan automatically on launch in a separate thread
        self.start_scan()
        
        self.last_canvas_width = 0
        
        # Run daily scheduler in a background daemon thread
        threading.Thread(target=run_daily_scheduler, args=(self,), daemon=True).start()
        
    def setup_styles(self):
        # Configure ttk scrollbar styling
        self.style = ttk.Style()
        self.style.theme_use('clam')
        self.style.configure("Vertical.TScrollbar", gripcount=0, background=BG_CARD, darkcolor=BG_CARD, lightcolor=BG_CARD, troughcolor=BG_MAIN, bordercolor=BG_MAIN)
        
    def create_widgets(self):
        # 1. Main Layout: Header, Status Bar, Content
        self.grid_rowconfigure(0, weight=0) # Header
        self.grid_rowconfigure(1, weight=0) # Filter Bar
        self.grid_rowconfigure(2, weight=0) # Summary Bar
        self.grid_rowconfigure(3, weight=1) # Main Scrollable Grid Area
        self.grid_columnconfigure(0, weight=1)
        
        # ─── HEADER ───────────────────────────────────────────────────────────
        header_frame = tk.Frame(self, bg=BG_HEADER, height=80, padx=20, pady=12)
        header_frame.grid(row=0, column=0, sticky="ew")
        header_frame.grid_propagate(False)
        header_frame.grid_columnconfigure(0, weight=1)
        header_frame.grid_columnconfigure(1, weight=0)
        
        # App Title & Subtitle
        title_sub_frame = tk.Frame(header_frame, bg=BG_HEADER)
        title_sub_frame.grid(row=0, column=0, sticky="w")
        
        title_lbl = tk.Label(title_sub_frame, text="🖨️ Printer Realtime Monitor", font=self.font_title, fg=TEXT_WHITE, bg=BG_HEADER)
        title_lbl.pack(anchor="w")
        sub_lbl = tk.Label(title_sub_frame, text="ระบบตรวจสอบสถานะเครื่องและยอดพิมพ์สะสมในเครือข่ายเรียลไทม์ (SNMP Scan)", font=self.font_body, fg=TEXT_GRAY, bg=BG_HEADER)
        sub_lbl.pack(anchor="w", pady=(2, 0))
        
        # Massive Scan Button
        self.scan_btn = tk.Button(
            header_frame,
            text="⚡ สแกนเรียลไทม์",
            font=("Segoe UI", 11, "bold"),
            fg=TEXT_WHITE,
            bg=ACCENT,
            activebackground=ACCENT_HOVER,
            activeforeground=TEXT_WHITE,
            bd=0,
            padx=20,
            pady=8,
            cursor="hand2",
            relief="flat",
            command=self.start_scan
        )
        self.scan_btn.grid(row=0, column=1, sticky="e")
        
        # ─── สร้าง summary_frame ก่อน (จำเป็นต้องมีก่อน render_stats ซึ่งเรียก render_summary)
        self.summary_frame = tk.Frame(self, bg="#0f172a", padx=20, pady=0)
        self.summary_frame.grid(row=2, column=0, sticky="ew")

        # ─── FILTER & STATS BAR ───────────────────────────────────────────────
        filter_stats_frame = tk.Frame(self, bg=BG_MAIN, padx=20, pady=10)
        filter_stats_frame.grid(row=1, column=0, sticky="ew")
        filter_stats_frame.grid_columnconfigure(0, weight=1) # Filter tabs
        filter_stats_frame.grid_columnconfigure(1, weight=0) # Stats badges
        
        # Zone Filters
        self.filter_container = tk.Frame(filter_stats_frame, bg=BG_MAIN)
        self.filter_container.grid(row=0, column=0, sticky="w")
        self.render_filter_tabs()
        
        # Quick Stats Frame
        self.stats_frame = tk.Frame(filter_stats_frame, bg=BG_MAIN)
        self.stats_frame.grid(row=0, column=1, sticky="e")
        self.render_stats()   # render_stats → render_summary → ใช้ summary_frame (มีแล้ว)
        self.render_summary() # เรียกครั้งแรกเผื่อ render_stats ไม่ได้เรียก
        
        # ─── SCROLLABLE CONTENT GRID ──────────────────────────────────────────
        grid_outer_frame = tk.Frame(self, bg=BG_MAIN)
        grid_outer_frame.grid(row=3, column=0, sticky="nsew", padx=20, pady=(0, 20))
        grid_outer_frame.grid_rowconfigure(0, weight=1)
        grid_outer_frame.grid_columnconfigure(0, weight=1)
        
        # Scrollable Canvas
        self.canvas = tk.Canvas(grid_outer_frame, bg=BG_MAIN, bd=0, highlightthickness=0)
        self.canvas.grid(row=0, column=0, sticky="nsew")
        
        scrollbar = AutoScrollbar(grid_outer_frame, orient="vertical", command=self.canvas.yview)
        scrollbar.grid(row=0, column=1, sticky="ns")
        self.canvas.configure(yscrollcommand=scrollbar.set)
        
        # Inner Frame where Cards will go
        self.canvas_frame = tk.Frame(self.canvas, bg=BG_MAIN)
        self.canvas_frame_id = self.canvas.create_window((0, 0), window=self.canvas_frame, anchor="nw")
        
        # Mousewheel Scrolling
        self.canvas.bind_all("<MouseWheel>", self.on_mousewheel)
        
        # Bind events for scrolling and responsive resizing
        self.canvas_frame.bind("<Configure>", self.on_frame_configure)
        self.canvas.bind("<Configure>", self.on_canvas_resize)
        
    def on_frame_configure(self, event):
        self.canvas.configure(scrollregion=self.canvas.bbox("all"))
        
    def on_canvas_resize(self, event):
        new_width = event.width
        if new_width != self.last_canvas_width:
            self.last_canvas_width = new_width
            self.canvas.itemconfig(self.canvas_frame_id, width=new_width)
            self.render_grid()

    def on_mousewheel(self, event):
        self.canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")
        
    def render_filter_tabs(self):
        # Clear old children
        for widget in self.filter_container.winfo_children():
            widget.destroy()
            
        zones = ["ทั้งหมด", "มัธยม", "ประถม", "อนุบาล", "ห้องปฏิบัติการ"]
        for idx, zone in enumerate(zones):
            active = (zone == self.active_zone)
            bg_col = ACCENT if active else BG_CARD
            fg_col = TEXT_WHITE if active else TEXT_GRAY
            
            btn = tk.Button(
                self.filter_container,
                text=zone,
                font=self.font_bold if active else self.font_body,
                fg=fg_col,
                bg=bg_col,
                activebackground=ACCENT_HOVER,
                activeforeground=TEXT_WHITE,
                bd=0,
                padx=14,
                pady=6,
                cursor="hand2",
                relief="flat",
                command=lambda z=zone: self.set_filter(z)
            )
            btn.pack(side="left", padx=(0, 8))
            
    def set_filter(self, zone):
        self.active_zone = zone
        self.render_filter_tabs()
        self.render_grid()
        
    def render_stats(self):
        # Clear stats
        for widget in self.stats_frame.winfo_children():
            widget.destroy()
            
        total = len(self.printers)
        online = sum(1 for p in self.printers if self.printer_data_cache.get(p["id"], {}).get("online", False))
        offline = total - online if not self.is_scanning else "..."
        
        stats_list = [
            ("เครื่องพิมพ์ทั้งหมด", str(total), TEXT_GRAY),
            ("สแกนออนไลน์", str(online), ONLINE_COLOR),
            ("ออฟไลน์/ปิดเครื่อง", str(offline), OFFLINE_COLOR if isinstance(offline, int) and offline > 0 else TEXT_GRAY)
        ]
        
        for idx, (label, val, col) in enumerate(stats_list):
            card = tk.Frame(self.stats_frame, bg=BG_CARD, padx=12, pady=4, highlightthickness=1, highlightbackground=BG_MAIN)
            card.pack(side="left", padx=(8, 0))
            
            val_lbl = tk.Label(card, text=val, font=self.font_stat_num, fg=col, bg=BG_CARD)
            val_lbl.pack(anchor="center")
            lbl = tk.Label(card, text=label, font=self.font_badge, fg=TEXT_GRAY, bg=BG_CARD)
            lbl.pack(anchor="center")

        self.render_summary()

    def render_summary(self):
        """แสดงแถบสรุปยอดรวม BW + สี รวมทุกเครื่อง และแยกตามโซน"""
        for widget in self.summary_frame.winfo_children():
            widget.destroy()

        # คำนวณยอดรวมเฉพาะเครื่องที่ออนไลน์และมีข้อมูล
        total_bw = 0
        total_color = 0
        zone_totals = {}  # zone -> {bw, color, count}

        for p in self.printers:
            pid = p["id"]
            zone = p["zone"]
            cached = self.printer_data_cache.get(pid, {})
            if not cached.get("online", False):
                continue
            bw = cached.get("bw", "—")
            color = cached.get("color", "—")
            bw_n = bw if isinstance(bw, int) else 0
            color_n = color if isinstance(color, int) else 0
            total_bw += bw_n
            total_color += color_n
            if zone not in zone_totals:
                zone_totals[zone] = {"bw": 0, "color": 0, "count": 0}
            zone_totals[zone]["bw"] += bw_n
            zone_totals[zone]["color"] += color_n
            zone_totals[zone]["count"] += 1

        has_data = any(self.printer_data_cache.get(p["id"], {}).get("online", False) for p in self.printers)
        if not has_data:
            # ยังไม่ได้สแกน – ซ่อน summary bar
            self.summary_frame.configure(pady=0)
            return

        self.summary_frame.configure(pady=8)

        # ── Header label ──
        hdr = tk.Label(
            self.summary_frame,
            text="📊 ยอดรวมมิเตอร์สะสม (เฉพาะออนไลน์)",
            font=("Segoe UI", 9, "bold"),
            fg=TEXT_GRAY,
            bg="#0f172a"
        )
        hdr.pack(anchor="w", pady=(0, 4))

        # ── Scrollable row of zone cards + grand total ──
        cards_row = tk.Frame(self.summary_frame, bg="#0f172a")
        cards_row.pack(fill="x")

        ZONES_ORDER = ["มัธยม", "ประถม", "อนุบาล", "ห้องปฏิบัติการ"]

        def fmt(n):
            return f"{n:,}" if n else "—"

        def make_zone_card(parent, zone_name, bw, color, count, bg_col, accent_col):
            card = tk.Frame(parent, bg=bg_col, padx=12, pady=8,
                            highlightthickness=1, highlightbackground="#334155")
            card.pack(side="left", padx=(0, 8), fill="y")

            # Zone name
            tk.Label(card, text=zone_name, font=("Segoe UI", 8, "bold"),
                     fg=accent_col, bg=bg_col).pack(anchor="w")
            tk.Label(card, text=f"{count} เครื่องออนไลน์",
                     font=("Segoe UI", 7), fg=TEXT_GRAY, bg=bg_col).pack(anchor="w", pady=(0, 4))

            # BW
            bw_row = tk.Frame(card, bg=bg_col)
            bw_row.pack(fill="x")
            tk.Label(bw_row, text="⬛ BW:", font=("Segoe UI", 8),
                     fg=TEXT_GRAY, bg=bg_col).pack(side="left")
            tk.Label(bw_row, text=fmt(bw), font=("Segoe UI", 9, "bold"),
                     fg=BW_COLOR, bg=bg_col).pack(side="right")

            # Color
            c_row = tk.Frame(card, bg=bg_col)
            c_row.pack(fill="x", pady=(2, 0))
            tk.Label(c_row, text="🎨 สี:", font=("Segoe UI", 8),
                     fg=TEXT_GRAY, bg=bg_col).pack(side="left")
            tk.Label(c_row, text=fmt(color), font=("Segoe UI", 9, "bold"),
                     fg=COLOR_COLOR, bg=bg_col).pack(side="right")

            # Total
            tot_row = tk.Frame(card, bg=bg_col)
            tot_row.pack(fill="x", pady=(4, 0))
            sep2 = tk.Label(card, text="─" * 20, font=("Consolas", 7),
                            fg="#334155", bg=bg_col)
            sep2.pack(fill="x")
            tk.Label(tot_row, text="รวม:", font=("Segoe UI", 8),
                     fg=TEXT_GRAY, bg=bg_col).pack(side="left")
            tk.Label(tot_row, text=fmt(bw + color),
                     font=("Segoe UI", 10, "bold"),
                     fg="#f8fafc", bg=bg_col).pack(side="right")

        # Zone cards
        for zone in ZONES_ORDER:
            if zone not in zone_totals:
                continue
            zt = zone_totals[zone]
            zcol = ZONE_COLORS.get(zone, ACCENT)
            make_zone_card(cards_row, zone,
                           zt["bw"], zt["color"], zt["count"],
                           BG_CARD, zcol)

        # Grand total card
        grand_card = tk.Frame(cards_row, bg="#1e1b4b", padx=14, pady=8,
                              highlightthickness=1, highlightbackground=ACCENT)
        grand_card.pack(side="left", padx=(16, 0), fill="y")

        tk.Label(grand_card, text="🏆 รวมทั้งหมด",
                 font=("Segoe UI", 9, "bold"), fg="#c4b5fd",
                 bg="#1e1b4b").pack(anchor="w")
        tk.Label(grand_card, text="ทุกแผนก",
                 font=("Segoe UI", 7), fg=TEXT_GRAY,
                 bg="#1e1b4b").pack(anchor="w", pady=(0, 4))

        bw_g = tk.Frame(grand_card, bg="#1e1b4b")
        bw_g.pack(fill="x")
        tk.Label(bw_g, text="⬛ BW:", font=("Segoe UI", 8),
                 fg=TEXT_GRAY, bg="#1e1b4b").pack(side="left")
        tk.Label(bw_g, text=fmt(total_bw),
                 font=("Segoe UI", 10, "bold"), fg=BW_COLOR,
                 bg="#1e1b4b").pack(side="right")

        c_g = tk.Frame(grand_card, bg="#1e1b4b")
        c_g.pack(fill="x", pady=(2, 0))
        tk.Label(c_g, text="🎨 สี:", font=("Segoe UI", 8),
                 fg=TEXT_GRAY, bg="#1e1b4b").pack(side="left")
        tk.Label(c_g, text=fmt(total_color),
                 font=("Segoe UI", 10, "bold"), fg=COLOR_COLOR,
                 bg="#1e1b4b").pack(side="right")

        tk.Label(grand_card, text="─" * 22, font=("Consolas", 7),
                 fg="#4338ca", bg="#1e1b4b").pack(fill="x")

        tot_g = tk.Frame(grand_card, bg="#1e1b4b")
        tot_g.pack(fill="x")
        tk.Label(tot_g, text="รวม:", font=("Segoe UI", 8),
                 fg=TEXT_GRAY, bg="#1e1b4b").pack(side="left")
        tk.Label(tot_g, text=fmt(total_bw + total_color),
                 font=("Segoe UI", 12, "bold"), fg="#a78bfa",
                 bg="#1e1b4b").pack(side="right")
            
    def load_printers(self):
        # ดึงข้อมูลเครื่องพิมพ์ล่าสุดจาก Google Sheets มาอัปเดตไฟล์ในเครื่องเบื้องหลัง (Background Thread)
        def sync_thread():
            if not GSHEETS_URL:
                return
            try:
                url = f"{GSHEETS_URL}?action=all"
                req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=8) as response:
                    res_body = response.read().decode('utf-8')
                    res_json = json.loads(res_body)
                    if res_json.get("success") and "printers" in res_json:
                        printers = res_json["printers"]
                        printers_path = os.path.join(BASE_DIR, "data", "printers.json")
                        os.makedirs(os.path.dirname(printers_path), exist_ok=True)
                        with open(printers_path, "w", encoding="utf-8") as f:
                            json.dump({"printers": printers}, f, ensure_ascii=False, indent=2)
                        
                        # อัปเดตรายชื่อเครื่องพิมพ์ใน GUI
                        self.printers = printers
                        
                        # เริ่มสแกนเรียลไทม์ใหม่เพื่อให้แสดงผลเครื่องที่เพิ่มเข้ามา
                        self.after(0, self.render_stats)
                        self.after(0, self.render_grid)
                        self.after(0, self.start_scan)
            except Exception as e:
                print(f"⚠️ Could not sync printers from Google Sheets: {str(e)}")
                
        threading.Thread(target=sync_thread, daemon=True).start()

        # โหลดค่าจาก Cache ในเครื่องก่อนเป็นลำดับแรก (เพื่อให้แสดงผลได้ทันทีโดยไม่ต้องรอเน็ตเวิร์ก)
        printers_path = os.path.join(BASE_DIR, "data", "printers.json")
        try:
            if os.path.exists(printers_path):
                with open(printers_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.printers = data.get("printers", [])
            else:
                messagebox.showerror("Error", f"ไม่สามารถหาไฟล์ printers.json ในโฟลเดอร์ {printers_path} ได้")
        except Exception as e:
            messagebox.showerror("Error", f"โหลดข้อมูลเครื่องพิมพ์ล้มเหลว: {str(e)}")
            
        # Init cache
        for p in self.printers:
            self.printer_data_cache[p["id"]] = {
                "online": False,
                "bw": "—",
                "color": "—",
                "latency": 0.0
            }
            
    def render_grid(self):
        # Clear old cards
        for widget in self.canvas_frame.winfo_children():
            widget.destroy()
            
        # Filter printers list
        filtered = self.printers if self.active_zone == "ทั้งหมด" else [p for p in self.printers if p["zone"] == self.active_zone]
        
        if not filtered:
            # Show empty state
            empty_lbl = tk.Label(
                self.canvas_frame,
                text="🔍 ไม่พบข้อมูลเครื่องพิมพ์ในโซนนี้",
                font=self.font_header,
                fg=TEXT_GRAY,
                bg=BG_MAIN,
                pady=100
            )
            empty_lbl.pack(fill="both", expand=True)
            return
            
        # Calculate column counts adaptively
        self.canvas_frame.update_idletasks()
        container_width = self.canvas.winfo_width() - 40 # Account for scrollbar and padding
        card_width = 300
        cols = max(1, int(container_width / card_width))
        
        # Distribute items into grid columns
        for idx, p in enumerate(filtered):
            r = idx // cols
            c = idx % cols
            
            # Setup container weight for grid
            self.canvas_frame.grid_columnconfigure(c, weight=1, minsize=card_width)
            
            card = self.create_printer_card(self.canvas_frame, p)
            card.grid(row=r, column=c, padx=10, pady=10, sticky="nsew")
            
    def create_printer_card(self, parent, p):
        pid = p["id"]
        p_type = p["type"]
        ip = p.get("ip", "")
        serial = p.get("serial", "")
        zone = p["zone"]
        location = p["location"]
        
        cached = self.printer_data_cache.get(pid, {"online": False, "bw": "—", "color": "—", "latency": 0.0})
        online = cached["online"]
        bw_val = cached["bw"]
        color_val = cached["color"]
        latency = cached["latency"]
        
        # Main Card Frame
        card_frame = tk.Frame(parent, bg=BG_CARD, bd=0, padx=16, pady=16, highlightthickness=1, highlightbackground="#334155")
        
        # Header: Zone Badge and Type Badge
        header = tk.Frame(card_frame, bg=BG_CARD)
        header.pack(fill="x", pady=(0, 8))
        
        zone_col = ZONE_COLORS.get(zone, ACCENT)
        zone_lbl = tk.Label(
            header,
            text=zone.upper(),
            font=self.font_badge,
            fg=TEXT_WHITE,
            bg=zone_col,
            padx=6,
            pady=2
        )
        zone_lbl.pack(side="left")
        
        type_txt = "🎨 สี" if p_type == "สี" else "⬛ ขาวดำ"
        type_col = COLOR_COLOR if p_type == "สี" else TEXT_GRAY
        type_lbl = tk.Label(
            header,
            text=type_txt,
            font=self.font_badge,
            fg=type_col,
            bg="#0f172a",
            padx=6,
            pady=2
        )
        type_lbl.pack(side="right")
        
        # Location Name
        loc_lbl = tk.Label(
            card_frame,
            text=location,
            font=self.font_header,
            fg=TEXT_WHITE,
            bg=BG_CARD,
            wraplength=260,
            justify="left"
        )
        loc_lbl.pack(anchor="w", pady=(0, 4))
        
        # Model Name (if available)
        model = p.get("model", "")
        if model:
            model_lbl = tk.Label(
                card_frame,
                text=model,
                font=self.font_bold,
                fg="#06b6d4",
                bg=BG_CARD
            )
            model_lbl.pack(anchor="w", pady=(0, 2))
            
        # Subtitle: IP and Serial
        sub_txt = f"{ip}  ·  {serial}" if serial else ip
        sub_lbl = tk.Label(
            card_frame,
            text=sub_txt,
            font=self.font_mono,
            fg=TEXT_GRAY,
            bg=BG_CARD
        )
        sub_lbl.pack(anchor="w", pady=(0, 12))
        
        # Status Bar: Online Dot & Latency
        status_bar = tk.Frame(card_frame, bg=BG_CARD)
        status_bar.pack(fill="x", pady=(0, 16))
        
        dot_char = "●"
        status_color = ONLINE_COLOR if online else OFFLINE_COLOR
        status_text = f"Online ({int(latency * 1000)}ms)" if online else "Offline"
        
        status_dot = tk.Label(status_bar, text=dot_char, font=("Segoe UI", 12), fg=status_color, bg=BG_CARD)
        status_dot.pack(side="left")
        
        status_lbl = tk.Label(status_bar, text=status_text, font=self.font_bold, fg=status_color, bg=BG_CARD)
        status_lbl.pack(side="left", padx=(4, 0))
        
        # Dotted Separator
        sep = tk.Label(card_frame, text="—" * 32, font=self.font_mono, fg="#334155", bg=BG_CARD)
        sep.pack(fill="x", pady=(0, 12))
        
        # Counters display frame
        counters_frame = tk.Frame(card_frame, bg=BG_CARD)
        counters_frame.pack(fill="x")
        
        # Black and White Counter (Shown always)
        bw_row = tk.Frame(counters_frame, bg=BG_CARD)
        bw_row.pack(fill="x", pady=2)
        
        bw_label = tk.Label(bw_row, text="⬛ ขาวดำ (BW) :", font=self.font_bold, fg=TEXT_GRAY, bg=BG_CARD)
        bw_label.pack(side="left")
        
        formatted_bw = f"{bw_val:,}" if isinstance(bw_val, int) else bw_val
        bw_val_lbl = tk.Label(bw_row, text=formatted_bw, font=("Segoe UI", 12, "bold"), fg=BW_COLOR, bg=BG_CARD)
        bw_val_lbl.pack(side="right")
        
        # Color Counter (Shown only if printer type is 'สี')
        if p_type == "สี":
            color_row = tk.Frame(counters_frame, bg=BG_CARD)
            color_row.pack(fill="x", pady=(6, 2))
            
            color_label = tk.Label(color_row, text="🎨 ยอดพิมพ์สี (Color) :", font=self.font_bold, fg=TEXT_GRAY, bg=BG_CARD)
            color_label.pack(side="left")
            
            formatted_color = f"{color_val:,}" if isinstance(color_val, int) else color_val
            color_val_lbl = tk.Label(color_row, text=formatted_color, font=("Segoe UI", 12, "bold"), fg=COLOR_COLOR, bg=BG_CARD)
            color_val_lbl.pack(side="right")
            
        # Mute card visually if offline
        if not online and not self.is_scanning:
            status_dot.configure(fg="#475569")
            status_lbl.configure(fg=TEXT_GRAY)
            loc_lbl.configure(fg=TEXT_GRAY)
            card_frame.configure(highlightbackground="#1e293b")
            bw_val_lbl.configure(fg="#475569")
            if p_type == "สี":
                color_val_lbl.configure(fg="#475569")
                
        return card_frame
        
    def start_scan(self):
        if self.is_scanning:
            return
            
        self.is_scanning = True
        self.scan_btn.configure(text="⏳ กำลังสแกน...", bg="#475569", state="disabled")
        
        # Start scanning in a background thread to prevent UI freezing
        threading.Thread(target=self.scan_network, daemon=True).start()
        
    def scan_network(self):
        # Create a list of worker threads to scan in parallel for extreme speed!
        threads = []
        results = {}
        lock = threading.Lock()
        
        def scan_single_printer(p):
            pid = p["id"]
            ip = p.get("ip")
            p_type = p["type"]
            
            if not ip:
                return
                
            start_time = time.time()
            online = ping_ip(ip)
            latency = time.time() - start_time
            
            bw = "—"
            color = "—"
            
            if online:
                # Query SNMP
                if p_type == "ขาวดำ":
                    total = query_printer_counter(ip, "1.3.6.1.2.1.43.10.2.1.4.1.1")
                    if total is None:
                        total = query_printer_counter(ip, "1.3.6.1.4.1.367.3.2.1.2.19.1.0")
                    bw = total if total is not None else "—"
                    color = 0
                else:  # p_type == "สี"
                    # 1. Try standard Ricoh B&W and Color OIDs
                    bw_snmp = query_printer_counter(ip, "1.3.6.1.4.1.367.3.2.1.2.19.5.1.9.3")
                    color_snmp = query_printer_counter(ip, "1.3.6.1.4.1.367.3.2.1.2.19.5.1.9.4")
                    
                    # 2. Try alternative Ricoh B&W and Color OIDs
                    if bw_snmp is None or color_snmp is None:
                        bw_alt = query_printer_counter(ip, "1.3.6.1.4.1.367.3.2.1.2.19.5.1.9.22")
                        color_alt = query_printer_counter(ip, "1.3.6.1.4.1.367.3.2.1.2.19.5.1.9.21")
                        if bw_alt is not None:
                            bw_snmp = bw_alt
                        if color_alt is not None:
                            color_snmp = color_alt
                            
                    # 3. Fallback to Total if one or both are still missing
                    if bw_snmp is None or color_snmp is None:
                        total = query_printer_counter(ip, "1.3.6.1.2.1.43.10.2.1.4.1.1")
                        if total is None:
                            total = query_printer_counter(ip, "1.3.6.1.4.1.367.3.2.1.2.19.1.0")
                        
                        if total is not None:
                            if bw_snmp is not None:
                                color_snmp = total - bw_snmp
                            elif color_snmp is not None:
                                bw_snmp = total - color_snmp
                            else:
                                bw_snmp = total
                                color_snmp = 0
                                
                    bw = bw_snmp if bw_snmp is not None else "—"
                    color = color_snmp if color_snmp is not None else "—"
            
            with lock:
                results[pid] = {
                    "online": online,
                    "bw": bw if bw is not None else "—",
                    "color": color if color is not None else "—",
                    "latency": latency
                }
                
        # Spin up threads for each printer
        for p in self.printers:
            t = threading.Thread(target=scan_single_printer, args=(p,))
            threads.append(t)
            t.start()
            
        # Wait for all threads to complete (parallel execution makes this super fast)
        for t in threads:
            t.join()
            
        # Update cache inside main thread via after
        self.after(0, self.finish_scan, results)
        
    def finish_scan(self, results):
        # Save results to cache
        for pid, data in results.items():
            self.printer_data_cache[pid] = data
            
        self.is_scanning = False
        self.scan_btn.configure(text="⚡ สแกนเรียลไทม์", bg=ACCENT, state="normal")
        
        # Redraw
        self.render_stats()   # render_stats จะเรียก render_summary ให้อัตโนมัติ
        self.render_grid()
        
        # Show mini notification
        online_count = sum(1 for d in results.values() if d["online"])
        total_bw = sum(d["bw"] for d in results.values() if isinstance(d.get("bw"), int))
        total_color = sum(d["color"] for d in results.values() if isinstance(d.get("color"), int))
        messagebox.showinfo(
            "สแกนสำเร็จ",
            f"⚡ ตรวจสอบและดึงยอดพิมพ์สำเร็จ!\n"
            f"- ออนไลน์: {online_count} เครื่อง\n"
            f"- ออฟไลน์: {len(results) - online_count} เครื่อง\n"
            f"────────────────\n"
            f"📊 ยอดมิเตอร์รวม (ออนไลน์):\n"
            f"  ⬛ BW รวม : {total_bw:,} แผ่น\n"
            f"  🎨 สี รวม : {total_color:,} แผ่น\n"
            f"  🏆 รวมทั้งหมด : {total_bw + total_color:,} แผ่น"
        )

if __name__ == "__main__":
    try:
        app = PrinterMonitorApp()
        app.mainloop()
    except Exception as e:
        import traceback
        with open("crash.log", "w", encoding="utf-8") as f:
            traceback.print_exc(file=f)
