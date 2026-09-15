package com.plainva.app;

import static org.junit.Assert.*;

import android.content.Context;
import android.database.Cursor;
import android.system.Os;
import android.system.OsConstants;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import net.zetetic.database.sqlcipher.SQLiteDatabase;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Native storage probe, including actual loading on 16 KB Android images. */
@RunWith(AndroidJUnit4.class)
public class StorageCompatibilityTest {
    @Test public void cameraNativeLibraryLoadsOnTheCurrentPageSize() {
        System.loadLibrary("image_processing_util_jni");
        System.loadLibrary("surface_util_jni");
    }

    @Test public void encryptedIndexKeepsBoundTextAndRollsBackAcrossReopen() throws Exception {
        String expectedPageSize = InstrumentationRegistry.getArguments().getString("expectedPageSize");
        if (expectedPageSize != null) {
            assertEquals(Long.parseLong(expectedPageSize), Os.sysconf(OsConstants._SC_PAGESIZE));
        }
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File directory = new File(context.getCacheDir(), "storage-compatibility-" + UUID.randomUUID());
        assertTrue(directory.mkdir());
        File file = new File(directory, "index.sqlite");
        String text = "---\nstatus: draft\n---\n# Größe 日本語\n- [ ] Preserve 'quotes'; DROP TABLE notes;\n";
        System.loadLibrary("sqlcipher");
        try {
            try (SQLiteDatabase db = SQLiteDatabase.openOrCreateDatabase(file, "disposable-probe-key", null, null)) {
                db.execSQL("CREATE TABLE notes(id TEXT PRIMARY KEY, body TEXT NOT NULL)");
                db.execSQL("CREATE VIRTUAL TABLE search USING fts5(body)");
                db.execSQL("INSERT INTO notes VALUES (?, ?)", new Object[]{"note", text});
                db.execSQL("INSERT INTO search VALUES (?)", new Object[]{text});
                db.beginTransaction();
                try {
                    db.execSQL("UPDATE notes SET body=? WHERE id=?", new Object[]{"uncommitted", "note"});
                } finally {
                    // No successful marker: the tentative change must roll back.
                    db.endTransaction();
                }
            }
            try (FileInputStream input = new FileInputStream(file)) {
                byte[] header = new byte[16];
                assertEquals(16, input.read(header));
                assertNotEquals("SQLite format 3\0", new String(header, StandardCharsets.US_ASCII));
            }
            try (SQLiteDatabase reopened = SQLiteDatabase.openOrCreateDatabase(file, "disposable-probe-key", null, null)) {
                try (Cursor note = reopened.rawQuery("SELECT body FROM notes WHERE id=?", new String[]{"note"})) {
                    assertTrue(note.moveToFirst());
                    assertEquals(text, note.getString(0));
                }
                try (Cursor search = reopened.rawQuery("SELECT count(*) FROM search WHERE search MATCH ?", new String[]{"Preserve"})) {
                    assertTrue(search.moveToFirst());
                    assertEquals(1, search.getInt(0));
                }
                try (Cursor integrity = reopened.rawQuery("PRAGMA integrity_check", null)) {
                    assertTrue(integrity.moveToFirst());
                    assertEquals("ok", integrity.getString(0));
                }
            }
        } finally {
            // Only files created inside this test's unique cache directory.
            File[] files = directory.listFiles();
            if (files != null) for (File owned : files) assertTrue(owned.delete());
            assertTrue(directory.delete());
        }
    }
}
