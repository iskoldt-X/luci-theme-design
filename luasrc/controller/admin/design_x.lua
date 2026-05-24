-- luci-theme-design-x LuCI Lua controller
--
-- Round 42 Step 166 — routes 3 streaming endpoints under
-- /cgi-bin/luci/admin/design-x/. Replaces the legacy unauthenticated
-- /cgi-bin/design/{download,upload,ping} CGI scripts with session-
-- gated controller entries. The LuCI dispatcher applies its default
-- session check before invoking any of these action_* functions, so
-- the unauthenticated public exposure is closed (Codex P1-6).
--
-- Why a Lua controller and not rpcd ubus: JSON-RPC framing can't
-- carry raw octet-stream bodies, which the speedtest endpoints need:
--   * download streams up to 1 GB of /dev/urandom verbatim
--   * upload reads and discards the raw POST body for throughput
--     measurement
-- ping is tiny but uses request RTT as its data source; the extra
-- JSON-RPC framing latency would defeat the measurement.
--
-- Sub-B2 followup (Round 43+): write a parallel ucode controller for
-- builds without luci-lua-runtime, mirroring the template dual-track
-- introduced by Step 161. For now, the Makefile adds +luci-lua-runtime
-- to LUCI_DEPENDS so this controller registers on every install.

module("luci.controller.admin.design_x", package.seeall)

function index()
	-- Mount point under /admin/design-x/. `dependent = false` so it
	-- doesn't get a menu entry, and the leaf action paths terminate
	-- routing (no sub-paths beyond ping/download/upload).
	entry({"admin", "design-x"}, firstchild(), nil, 99).dependent = false
	entry({"admin", "design-x", "download"}, call("action_download")).leaf = true
	entry({"admin", "design-x", "upload"},   call("action_upload")).leaf   = true
	entry({"admin", "design-x", "ping"},     call("action_ping")).leaf     = true
end

-- ──────────────────────────────────────────────────────────────────────
-- ping — tiny pong responder. Browser measures HTTP RTT as latency;
-- body content is not used by the consumer. Mirrors the legacy
-- /cgi-bin/design/ping verbatim.
-- ──────────────────────────────────────────────────────────────────────
function action_ping()
	local http = require "luci.http"
	http.prepare_content("text/plain")
	http.header("Cache-Control", "no-store")
	http.write("pong")
end

-- ──────────────────────────────────────────────────────────────────────
-- download — stream random bytes for download-side speedtest. Mirrors
-- the legacy /cgi-bin/design/download: bytes= clamped to
-- [1024, 1073741824], default 52428800 (50 MB). /dev/urandom is
-- incompressible so intermediate caches can't artificially inflate
-- the measured throughput. 64 KB block size keeps memory bounded
-- regardless of total payload size.
-- ──────────────────────────────────────────────────────────────────────
function action_download()
	local http = require "luci.http"

	local bytes = tonumber(http.formvalue("bytes")) or 52428800
	if bytes < 1024       then bytes = 1024       end
	if bytes > 1073741824 then bytes = 1073741824 end

	http.prepare_content("application/octet-stream")
	http.header("Content-Length", tostring(bytes))
	http.header("Cache-Control",  "no-store")

	local fd = io.open("/dev/urandom", "rb")
	if not fd then return end

	local BLOCK     = 65536
	local remaining = bytes
	while remaining > 0 do
		local chunk = (remaining < BLOCK) and remaining or BLOCK
		local data  = fd:read(chunk)
		if not data or #data == 0 then break end
		http.write(data)
		remaining = remaining - #data
	end
	fd:close()
end

-- ──────────────────────────────────────────────────────────────────────
-- upload — discard the POST body for upload-side speedtest. Mirrors
-- the legacy /cgi-bin/design/upload: reads stdin to EOF in 64 KB blocks
-- via dd of=/dev/null, returns "ok". The LuCI filehandler API
-- consumes each incoming chunk; binding a noop discards without
-- buffering, keeping memory bounded regardless of upload size.
-- ──────────────────────────────────────────────────────────────────────
function action_upload()
	local http = require "luci.http"

	-- setfilehandler MUST come BEFORE the first body read. The
	-- noop handler discards each chunk as it arrives — no
	-- per-request allocation grows with upload size.
	http.setfilehandler(function(meta, chunk, eof)
		-- discard
	end)

	-- formvalue() triggers the body parse with our handler installed.
	http.formvalue()

	http.prepare_content("text/plain")
	http.header("Cache-Control", "no-store")
	http.write("ok")
end
