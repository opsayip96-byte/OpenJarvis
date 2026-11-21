package com.openjarvis.jarvis;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.content.ContentValues;
import android.content.Context;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "JarvisMemory")
public class JarvisMemoryPlugin extends Plugin {
    private MemoryDb db;

    @Override
    public void load() {
        super.load();
        db = new MemoryDb(getContext());
    }

    @PluginMethod
    public void save(PluginCall call) {
        String content = call.getString("content", "").trim();
        String category = call.getString("category", "general").trim();
        if (content.isEmpty()) {
            call.reject("Memory content cannot be empty.", "EMPTY_MEMORY");
            return;
        }
        ContentValues values = new ContentValues();
        values.put("content", content);
        values.put("category", category.isEmpty() ? "general" : category);
        values.put("created_at", System.currentTimeMillis());
        long id = db.getWritableDatabase().insert("memories", null, values);
        if (id < 0) {
            call.reject("Could not save this memory.", "MEMORY_SAVE_FAILED");
            return;
        }
        call.resolve(new JSObject().put("id", id).put("content", content).put("category", category));
    }

    @PluginMethod
    public void list(PluginCall call) {
        int limit = Math.max(1, Math.min(call.getInt("limit", 50), 200));
        JSArray rows = new JSArray();
        try (Cursor c = db.getReadableDatabase().rawQuery(
            "SELECT id, content, category, created_at FROM memories ORDER BY id DESC LIMIT ?",
            new String[]{String.valueOf(limit)})) {
            while (c.moveToNext()) rows.put(row(c));
        }
        call.resolve(new JSObject().put("items", rows));
    }

    @PluginMethod
    public void search(PluginCall call) {
        String query = call.getString("query", "").trim();
        int limit = Math.max(1, Math.min(call.getInt("limit", 20), 100));
        JSArray rows = new JSArray();
        if (!query.isEmpty()) {
            try (Cursor c = db.getReadableDatabase().rawQuery(
                "SELECT id, content, category, created_at FROM memories WHERE content LIKE ? OR category LIKE ? ORDER BY id DESC LIMIT ?",
                new String[]{"%" + query + "%", "%" + query + "%", String.valueOf(limit)})) {
                while (c.moveToNext()) rows.put(row(c));
            }
        }
        call.resolve(new JSObject().put("items", rows));
    }

    @PluginMethod
    public void delete(PluginCall call) {
        long id = call.getLong("id", -1L);
        if (id < 1) {
            call.reject("A valid memory ID is required.", "INVALID_MEMORY_ID");
            return;
        }
        int deleted = db.getWritableDatabase().delete("memories", "id=?", new String[]{String.valueOf(id)});
        call.resolve(new JSObject().put("deleted", deleted > 0));
    }

    @PluginMethod
    public void count(PluginCall call) {
        try (Cursor c = db.getReadableDatabase().rawQuery("SELECT COUNT(*) FROM memories", null)) {
            int count = c.moveToFirst() ? c.getInt(0) : 0;
            call.resolve(new JSObject().put("count", count));
        }
    }

    private JSObject row(Cursor c) {
        return new JSObject()
            .put("id", c.getLong(0))
            .put("content", c.getString(1))
            .put("category", c.getString(2))
            .put("createdAt", c.getLong(3));
    }

    private static final class MemoryDb extends SQLiteOpenHelper {
        MemoryDb(Context context) { super(context, "jarvis_local_memory.db", null, 1); }
        @Override public void onCreate(SQLiteDatabase db) {
            db.execSQL("CREATE TABLE memories (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'general', created_at INTEGER NOT NULL)");
            db.execSQL("CREATE INDEX memories_created_at_idx ON memories(created_at)");
        }
        @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
            // Versioned migrations are added here. Existing rows are never dropped.
        }
    }
}
