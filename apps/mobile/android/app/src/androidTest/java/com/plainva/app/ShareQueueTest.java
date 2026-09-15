package com.plainva.app;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import androidx.core.content.FileProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.util.*;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class ShareQueueTest {
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    private ShareQueue store() throws Exception { return new ShareQueue(new File(context.getNoBackupFilesDir(), "queue-test-" + UUID.randomUUID())); }
    private Intent text() { return new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "Shared fixture text"); }

    @Test public void textSurvivesReadAndAcknowledgementNeedsTheNote() throws Exception {
        ShareQueue store = store(); String id = UUID.randomUUID().toString();
        store.accept(context, text(), id); assertEquals(1, store.list().length()); assertEquals(1, store.list().length());
        try { store.finish(id, false); fail("premature ack"); } catch (IOException expected) { assertEquals("SHARE_INCOMPLETE", expected.getMessage()); }
        JSONObject plan = new JSONObject().put("vaultId", "fixture").put("notePath", "Inbox/Fixture.md");
        store.begin(id, plan); assertEquals("fixture", store.begin(id, new JSONObject().put("vaultId", "wrong")).getJSONObject("plan").getString("vaultId"));
        store.mark(id, null, true); store.finish(id, false); store.finish(id, false);
        store.accept(context, text(), id); assertEquals(0, store.list().length());
        store.accept(context, text(), UUID.randomUUID().toString()); assertEquals(1, store.list().length());
    }
    @Test public void fileIsStreamedAndCheckpointedBeforeCleanup() throws Exception {
        ShareQueue store = store(); String id = UUID.randomUUID().toString();
        File source = new File(context.getCacheDir(), "queue-source-" + UUID.randomUUID() + ".bin");
        byte[] bytes = new byte[300000]; Arrays.fill(bytes, (byte)72);
        try (FileOutputStream output = new FileOutputStream(source)) { output.write(bytes); }
        Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", source);
        try {
            store.accept(context, text().setType("application/octet-stream").putExtra(Intent.EXTRA_STREAM, uri), id);
            JSONObject file = store.list().getJSONObject(0).getJSONArray("files").getJSONObject(0); String fileId = file.getString("id");
            assertEquals(bytes.length, file.getLong("size"));
            assertEquals(ShareQueue.CHUNK_LIMIT, android.util.Base64.decode(store.chunk(id, fileId, 0, ShareQueue.CHUNK_LIMIT), android.util.Base64.DEFAULT).length);
            try { store.chunk(id, "../escape", 0, 1); fail("path traversal"); } catch (IOException expected) { assertEquals("SHARE_INVALID", expected.getMessage()); }
            try { store.chunk(id, fileId, 0, ShareQueue.CHUNK_LIMIT + 1); fail("unbounded read"); } catch (IOException expected) { assertEquals("SHARE_INVALID", expected.getMessage()); }
            store.begin(id, new JSONObject().put("vaultId", "fixture"));
            try { store.mark(id, null, true); fail("attachment not yet durable"); } catch (IOException expected) { assertEquals("SHARE_INCOMPLETE", expected.getMessage()); }
            store.mark(id, fileId, false); store.mark(id, fileId, false); store.mark(id, null, true); store.finish(id, false);
            assertEquals(0, store.list().length());
        } finally { source.delete(); }
    }
    @Test public void badPayloadIsVisibleAndDoesNotConsumeAnotherShare() throws Exception {
        ShareQueue store = store(); String first = UUID.randomUUID().toString(), bad = UUID.randomUUID().toString();
        store.accept(context, text(), first);
        try { store.accept(context, text().putExtra(Intent.EXTRA_STREAM, Uri.parse("file:///private/secret")), bad); fail("file URI accepted"); }
        catch (IOException expected) { assertEquals("SHARE_TYPE", expected.getMessage()); }
        JSONArray entries = store.list(); assertEquals(2, entries.length()); assertEquals("failed", store.read(bad).getString("status"));
        store.finish(bad, true); assertEquals(1, store.list().length()); assertEquals(first, store.list().getJSONObject(0).getString("id"));
    }
    @Test public void manifestWriteFailureNeverCreatesAReadyEntry() throws Exception {
        File root = new File(context.getNoBackupFilesDir(), "queue-write-test-" + UUID.randomUUID()); ShareQueue store = new ShareQueue(root);
        String id = UUID.randomUUID().toString(); File manifest = new File(new File(root, id), "manifest.json"); assertTrue(manifest.mkdirs());
        try { store.accept(context, text(), id); fail("directory treated as acknowledged manifest"); }
        catch (Exception expected) { /* The source was not acknowledged. */ }
    }

    @Test public void interruptedFirstSaveDoesNotBlockOtherTransfers() throws Exception {
        File root = new File(context.getNoBackupFilesDir(), "queue-orphan-test-" + UUID.randomUUID()); ShareQueue store = new ShareQueue(root);
        String orphan = UUID.randomUUID().toString(), ready = UUID.randomUUID().toString();
        File directory = new File(root, orphan); assertTrue(directory.mkdir());
        File payload = new File(directory, "interrupted.bin");
        try (FileOutputStream out = new FileOutputStream(payload)) { out.write(new byte[]{1, 2, 3}); }
        store.accept(context, text(), ready);
        assertEquals(2, store.list().length()); assertEquals("SHARE_INTERRUPTED", store.read(orphan).getString("failure"));
        assertTrue(payload.exists()); store.finish(orphan, true); assertFalse(payload.exists());
        assertEquals(ready, store.list().getJSONObject(0).getString("id"));
    }
}
