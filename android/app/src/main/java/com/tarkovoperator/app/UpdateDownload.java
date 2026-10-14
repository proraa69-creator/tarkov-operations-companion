package com.tarkovoperator.app;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * The network and file part of the in-app update (ApkUpdaterPlugin), without Android classes so that it is tested on
 * the JVM (src/test/…/UpdateDownloadTest.java). Only files under https://raidos.app/download/android/ are fetched: the
 * release description (version.json) and the APK it names. Redirects are not followed.
 */
final class UpdateDownload {
    static final String HOST = "raidos.app";
    static final String PATH = "/download/android/";
    /** A bigger file is refused before anything is written. */
    static final long MAX_APK_BYTES = 300L * 1024 * 1024;
    static final int MAX_MANIFEST_BYTES = 64 * 1024;

    /** A failure with a short code; src/mobile/androidUpdate.ts turns the code into the player's message. */
    static class UpdateException extends IOException {
        final String code;

        UpdateException(String code) {
            super(code);
            this.code = code;
        }
    }

    /** Any answer but 200 (404: nothing is published yet). */
    static final class HttpStatusException extends UpdateException {
        final int status;

        HttpStatusException(int status) {
            super("http-" + status);
            this.status = status;
        }
    }

    interface Progress {
        void update(long received, long total);
    }

    private UpdateDownload() {}

    /** The address if it is an HTTPS file under raidos.app/download/android/, else UpdateException("bad-url"). */
    static URL checkedUrl(String raw) throws UpdateException {
        try {
            URL url = new URL(raw);
            String path = url.getPath();
            boolean ok = "https".equals(url.getProtocol()) && HOST.equals(url.getHost())
                && (url.getPort() == -1 || url.getPort() == 443)
                && url.getUserInfo() == null && url.getQuery() == null && url.getRef() == null
                && path.startsWith(PATH) && path.length() > PATH.length()
                && !path.contains("..") && !path.contains("%") && !path.contains("//") && !path.contains("\\");
            if (ok) return url;
        } catch (IOException | RuntimeException ignored) {
            // falls through to the refusal
        }
        throw new UpdateException("bad-url");
    }

    static boolean isSha256(String value) {
        return value != null && value.matches("[0-9a-f]{64}");
    }

    static HttpURLConnection open(URL url) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(30_000);
        connection.setUseCaches(false);
        connection.setRequestProperty("Accept-Encoding", "identity");
        connection.setRequestProperty("Cache-Control", "no-cache");
        int status = connection.getResponseCode();
        if (status != HttpURLConnection.HTTP_OK) {
            connection.disconnect();
            throw new HttpStatusException(status);
        }
        return connection;
    }

    /** The release description as text (UTF-8, at most MAX_MANIFEST_BYTES). */
    static String fetchText(String raw) throws IOException {
        HttpURLConnection connection = open(checkedUrl(raw));
        try (InputStream in = connection.getInputStream()) {
            return readLimited(in, MAX_MANIFEST_BYTES);
        } finally {
            connection.disconnect();
        }
    }

    static String readLimited(InputStream in, int limit) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int read;
        while ((read = in.read(buffer)) != -1) {
            if (out.size() + read > limit) throw new UpdateException("too-large");
            out.write(buffer, 0, read);
        }
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }

    /**
     * Copies `in` to `out`: at most `expected` bytes, and exactly that many in the end. Returns the SHA-256 (hex) of what
     * was copied.
     */
    static String copyWithDigest(InputStream in, OutputStream out, long expected, Progress progress) throws IOException {
        MessageDigest digest = sha256();
        byte[] buffer = new byte[64 * 1024];
        long received = 0;
        int read;
        while ((read = in.read(buffer)) != -1) {
            received += read;
            if (received > expected) throw new UpdateException("size");
            digest.update(buffer, 0, read);
            out.write(buffer, 0, read);
            if (progress != null) progress.update(received, expected);
        }
        if (received != expected) throw new UpdateException("incomplete");
        return hex(digest.digest());
    }

    /**
     * Downloads the APK into `target` (written to `target`.part first) and checks its size and SHA-256. An earlier
     * download of the same file is kept: nothing is fetched again.
     */
    static File download(String raw, String sha256, long size, File target, Progress progress) throws IOException {
        if (!isSha256(sha256) || size <= 0 || size > MAX_APK_BYTES) throw new UpdateException("bad-release");
        URL url = checkedUrl(raw);
        if (target.isFile() && target.length() == size && sha256.equals(fileSha256(target))) return target;
        File dir = target.getParentFile();
        if (dir != null && !dir.isDirectory() && !dir.mkdirs()) throw new UpdateException("storage");
        File part = new File(target.getPath() + ".part");
        HttpURLConnection connection = open(url);
        try {
            long length = connection.getContentLengthLong();
            if (length >= 0 && length != size) throw new UpdateException("size");
            String actual;
            try (InputStream in = new BufferedInputStream(connection.getInputStream()); OutputStream out = new FileOutputStream(part)) {
                actual = copyWithDigest(in, out, size, progress);
            }
            if (!sha256.equals(actual)) throw new UpdateException("checksum");
            if (target.exists() && !target.delete()) throw new UpdateException("storage");
            if (!part.renameTo(target)) throw new UpdateException("storage");
            return target;
        } finally {
            connection.disconnect();
            if (part.exists()) //noinspection ResultOfMethodCallIgnored
                part.delete();
        }
    }

    static String fileSha256(File file) throws IOException {
        MessageDigest digest = sha256();
        byte[] buffer = new byte[64 * 1024];
        try (InputStream in = new FileInputStream(file)) {
            int read;
            while ((read = in.read(buffer)) != -1) digest.update(buffer, 0, read);
        }
        return hex(digest.digest());
    }

    static String hex(byte[] bytes) {
        StringBuilder text = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) text.append(String.format("%02x", value & 0xff));
        return text.toString();
    }

    static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }
}
