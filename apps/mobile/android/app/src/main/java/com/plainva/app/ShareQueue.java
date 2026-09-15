package com.plainva.app;

import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.system.Os;
import android.system.OsConstants;
import android.util.Base64;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.json.*;

/** Private, non-backed-up staging. A read never consumes a transfer. */
final class ShareQueue {
    static final long FILE_LIMIT = 25L * 1024 * 1024, ENTRY_LIMIT = 50L * 1024 * 1024;
    static final int CHUNK_LIMIT = 256 * 1024, TEXT_LIMIT = 512 * 1024;
    private final File root;
    ShareQueue(Context context) throws Exception {
        this(new File(context.getNoBackupFilesDir(), "share-inbox-v1"));
    }
    ShareQueue(File location) throws Exception {
        root = location;
        if (!root.isDirectory() && !root.mkdirs()) throw new IOException("SHARE_STORAGE");
    }
    static String id(String value) throws IOException {
        if (value == null || !value.matches("[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}")) throw new IOException("SHARE_INVALID");
        return value;
    }
    private File dir(String value) throws Exception { return new File(root, id(value)); }
    private static void syncDir(File directory) throws Exception {
        FileDescriptor fd = Os.open(directory.getAbsolutePath(), OsConstants.O_RDONLY, 0);
        try { Os.fsync(fd); } finally { Os.close(fd); }
    }
    private void save(JSONObject entry) throws Exception {
        File folder = dir(entry.getString("id"));
        if (!folder.isDirectory() && !folder.mkdir()) throw new IOException("SHARE_STORAGE");
        byte[] bytes = entry.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length > 8 * 1024 * 1024) throw new IOException("SHARE_LIMIT");
        File temp = File.createTempFile(".manifest-", ".tmp", folder);
        try {
            try (FileOutputStream out = new FileOutputStream(temp)) { out.write(bytes); out.getFD().sync(); }
            Os.rename(temp.getAbsolutePath(), new File(folder, "manifest.json").getAbsolutePath());
            syncDir(folder); syncDir(root);
        } finally { if (temp.exists()) temp.delete(); }
    }
    JSONObject read(String shareId) throws Exception {
        File folder = dir(shareId), manifest = new File(folder, "manifest.json");
        // The process may die after mkdir but before its first atomic manifest.
        // Retain any bytes and expose an incomplete transfer for explicit discard.
        if (folder.isDirectory() && !manifest.exists()) {
            JSONObject interrupted = new JSONObject().put("version", 1).put("id", shareId)
                .put("createdAt", folder.lastModified()).put("status", "failed")
                .put("failure", "SHARE_INTERRUPTED").put("text", "").put("subject", "").put("files", new JSONArray());
            save(interrupted); return interrupted;
        }
        if (manifest.length() > 8 * 1024 * 1024) throw new IOException("SHARE_INVALID");
        try (InputStream in = new FileInputStream(manifest); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int n;
            while ((n = in.read(buffer)) != -1) { if (out.size() + n > 8 * 1024 * 1024) throw new IOException("SHARE_INVALID"); out.write(buffer, 0, n); }
            JSONObject value = new JSONObject(out.toString(StandardCharsets.UTF_8.name()));
            if (!shareId.equals(value.getString("id")) || value.getInt("version") != 1) throw new IOException("SHARE_INVALID");
            return value;
        }
    }
    private boolean finished(JSONObject e) { return "completed".equals(e.optString("status")) || "discarded".equals(e.optString("status")); }
    private File[] directories() { File[] dirs = root.listFiles(File::isDirectory); return dirs == null ? new File[0] : dirs; }
    JSONArray list() throws Exception {
        List<JSONObject> pending = new ArrayList<>();
        for (File folder : directories()) {
            JSONObject e = read(folder.getName());
            if (finished(e)) { cleanup(e.getString("id")); continue; }
            // All staging and plugin calls share one executor. A receiving
            // entry seen here survived a process exit before staging finished.
            if ("receiving".equals(e.optString("status"))) { e.put("status", "failed").put("failure", "SHARE_INTERRUPTED"); save(e); }
            pending.add(e);
        }
        pending.sort(Comparator.comparingLong(e -> e.optLong("createdAt")));
        return new JSONArray(pending);
    }
    boolean accept(Context context, Intent intent, String shareId) throws Exception {
        if (dir(shareId).exists()) {
            JSONObject existing = read(shareId);
            if (finished(existing)) return false;
            if (!"ready".equals(existing.getString("status"))) throw new IOException("SHARE_INCOMPLETE");
            return true;
        }
        long reserved = 0; int count = 0;
        for (File folder : directories()) {
            JSONObject old = read(folder.getName());
            if (finished(old)) continue;
            count++;
            if ("receiving".equals(old.optString("status"))) reserved += ENTRY_LIMIT;
            else { File[] payloads = folder.listFiles(f -> f.getName().endsWith(".bin")); if (payloads != null) for (File f : payloads) reserved += f.length(); }
        }
        if (count >= 20 || reserved + ENTRY_LIMIT > 200L * 1024 * 1024) throw new IOException("SHARE_QUEUE_FULL");
        String text = Objects.toString(intent.getCharSequenceExtra(Intent.EXTRA_TEXT), "");
        String subject = Objects.toString(intent.getStringExtra(Intent.EXTRA_SUBJECT), "");
        if ((text + subject).getBytes(StandardCharsets.UTF_8).length > TEXT_LIMIT) throw new IOException("SHARE_LIMIT");
        JSONObject e = new JSONObject().put("version", 1).put("id", shareId).put("createdAt", System.currentTimeMillis())
            .put("status", "receiving").put("text", text).put("subject", subject).put("files", new JSONArray());
        save(e);
        try {
            List<Uri> uris = new ArrayList<>();
            if (Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())) {
                ArrayList<Uri> incoming = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM); if (incoming != null) uris.addAll(incoming);
            } else { Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM); if (uri != null) uris.add(uri); }
            if (uris.isEmpty() && intent.getClipData() != null) {
                for (int i = 0; i < intent.getClipData().getItemCount(); i++) { Uri uri = intent.getClipData().getItemAt(i).getUri(); if (uri != null) uris.add(uri); }
            }
            if (uris.size() > 10 || (uris.isEmpty() && text.isEmpty())) throw new IOException("SHARE_TYPE");
            long total = 0;
            for (Uri uri : uris) {
                if (uri == null || !"content".equals(uri.getScheme())) throw new IOException("SHARE_TYPE");
                String fileId = UUID.randomUUID().toString(), name = "Shared", mime = context.getContentResolver().getType(uri);
                try (Cursor c = context.getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                    if (c != null && c.moveToFirst() && !c.isNull(0)) name = c.getString(0);
                }
                if (name.length() > 512 || (mime != null && mime.length() > 256)) throw new IOException("SHARE_LIMIT");
                MessageDigest hash = MessageDigest.getInstance("SHA-256"); long size = 0;
                try (InputStream in = context.getContentResolver().openInputStream(uri); FileOutputStream out = new FileOutputStream(new File(dir(shareId), fileId + ".bin"))) {
                    if (in == null) throw new IOException("SHARE_INCOMPLETE");
                    byte[] buffer = new byte[64 * 1024]; int n;
                    while ((n = in.read(buffer)) != -1) { size += n; if (size > FILE_LIMIT || total + size > ENTRY_LIMIT) throw new IOException("SHARE_LIMIT"); out.write(buffer, 0, n); hash.update(buffer, 0, n); }
                    out.getFD().sync();
                }
                total += size;
                StringBuilder hex = new StringBuilder(); for (byte b : hash.digest()) hex.append(String.format(Locale.ROOT, "%02x", b & 255));
                e.getJSONArray("files").put(new JSONObject().put("id", fileId).put("name", name).put("mime", mime == null ? "application/octet-stream" : mime).put("size", size).put("sha256", hex.toString()));
                save(e);
            }
            e.put("status", "ready"); save(e); return true;
        } catch (Exception failure) {
            e.put("status", "failed").put("failure", code(failure)); save(e); throw failure;
        }
    }
    static String code(Exception e) { String message = e.getMessage(); return message != null && message.matches("SHARE_[A-Z_]+") ? message : "SHARE_STORAGE"; }
    JSONObject begin(String shareId, JSONObject plan) throws Exception {
        JSONObject e = read(shareId);
        if (!"ready".equals(e.getString("status"))) throw new IOException("SHARE_INCOMPLETE");
        if (!e.has("plan")) { if (plan.toString().getBytes(StandardCharsets.UTF_8).length > 4 * 1024 * 1024) throw new IOException("SHARE_LIMIT"); e.put("plan", plan); save(e); }
        return e;
    }
    void mark(String shareId, String fileId, boolean note) throws Exception {
        JSONObject e = read(shareId);
        if (!"ready".equals(e.getString("status")) || !e.has("plan")) throw new IOException("SHARE_INVALID");
        JSONArray done = e.optJSONArray("filesDone"); if (done == null) done = new JSONArray();
        if (note) { if (done.length() != e.getJSONArray("files").length()) throw new IOException("SHARE_INCOMPLETE"); e.put("noteWritten", true); }
        else {
            id(fileId); boolean found = false, already = false;
            for (int i = 0; i < e.getJSONArray("files").length(); i++) found |= fileId.equals(e.getJSONArray("files").getJSONObject(i).getString("id"));
            for (int i = 0; i < done.length(); i++) already |= fileId.equals(done.getString(i));
            if (!found) throw new IOException("SHARE_INVALID"); if (!already) done.put(fileId); e.put("filesDone", done);
        }
        save(e);
    }
    String chunk(String shareId, String fileId, long offset, int length) throws Exception {
        JSONObject e = read(shareId); id(fileId);
        if (!"ready".equals(e.getString("status")) || offset < 0 || length < 0 || length > CHUNK_LIMIT) throw new IOException("SHARE_INVALID");
        JSONObject file = null; JSONArray files = e.getJSONArray("files");
        for (int i = 0; i < files.length(); i++) if (fileId.equals(files.getJSONObject(i).getString("id"))) file = files.getJSONObject(i);
        if (file == null || offset > file.getLong("size") - length) throw new IOException("SHARE_INVALID");
        byte[] bytes = new byte[length];
        try (RandomAccessFile input = new RandomAccessFile(new File(dir(shareId), fileId + ".bin"), "r")) { input.seek(offset); input.readFully(bytes); }
        return Base64.encodeToString(bytes, Base64.NO_WRAP);
    }
    void finish(String shareId, boolean discard) throws Exception {
        JSONObject e = read(shareId);
        if (!finished(e)) {
            if (!discard && !e.optBoolean("noteWritten")) throw new IOException("SHARE_INCOMPLETE");
            // Keep only an identity receipt: an Android intent restored after
            // acknowledgement must not import its source again.
            save(new JSONObject().put("version", 1).put("id", shareId).put("createdAt", e.getLong("createdAt")).put("status", discard ? "discarded" : "completed"));
        }
        cleanup(shareId);
    }
    private void cleanup(String shareId) throws Exception {
        File folder = dir(shareId); File[] files = folder.listFiles();
        if (files != null) for (File file : files) if (!file.getName().equals("manifest.json") && file.isFile()) {
            if (!file.getCanonicalFile().getParentFile().equals(folder.getCanonicalFile())) throw new IOException("SHARE_INVALID");
            if (!file.delete()) throw new IOException("SHARE_STORAGE");
        }
    }
}
