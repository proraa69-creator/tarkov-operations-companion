package com.tarkovoperator.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

/** The checks of the in-app update that need no phone: the address, the size and the SHA-256 of the download. */
public class UpdateDownloadTest {
    private static final byte[] APK = "not really an apk, but bytes".getBytes(StandardCharsets.UTF_8);
    private static final String APK_SHA256 = UpdateDownload.hex(UpdateDownload.sha256().digest(APK));

    @Test
    public void onlyFilesUnderTheSiteDownloadFolderAreFetched() throws Exception {
        assertEquals("/download/android/version.json", UpdateDownload.checkedUrl("https://raidos.app/download/android/version.json").getPath());
        UpdateDownload.checkedUrl("https://raidos.app:443/download/android/raid-os-0.6.0.30.apk");
        for (String bad : new String[] {
            null,
            "",
            "http://raidos.app/download/android/version.json",
            "https://raidos.app.evil.example/download/android/version.json",
            "https://evil.example/download/android/version.json",
            "https://user@raidos.app/download/android/version.json",
            "https://raidos.app:8443/download/android/version.json",
            "https://raidos.app/download/android/",
            "https://raidos.app/download/windows",
            "https://raidos.app/download/android/../windows",
            "https://raidos.app/download/android/%2e%2e/windows",
            "https://raidos.app/download/android//x.apk",
            "https://raidos.app/download/android/x.apk?y=1",
            "https://raidos.app/download/android/x.apk#y",
            "file:///sdcard/download/android/x.apk",
        }) {
            try {
                UpdateDownload.checkedUrl(bad);
                fail("accepted " + bad);
            } catch (UpdateDownload.UpdateException expected) {
                assertEquals("bad-url", expected.code);
            }
        }
    }

    @Test
    public void theCopyIsHashedAndMustHaveTheAnnouncedSize() throws Exception {
        List<Long> progress = new ArrayList<>();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        String digest = UpdateDownload.copyWithDigest(new ByteArrayInputStream(APK), out, APK.length, (received, total) -> {
            assertEquals(APK.length, total);
            progress.add(received);
        });
        assertEquals(APK_SHA256, digest);
        assertEquals(APK.length, out.size());
        assertEquals(Long.valueOf(APK.length), progress.get(progress.size() - 1));

        assertCode("size", () -> UpdateDownload.copyWithDigest(new ByteArrayInputStream(APK), new ByteArrayOutputStream(), APK.length - 1, null));
        assertCode("incomplete", () -> UpdateDownload.copyWithDigest(new ByteArrayInputStream(APK), new ByteArrayOutputStream(), APK.length + 1, null));
    }

    @Test
    public void aBadReleaseIsRefusedBeforeAnyNetwork() {
        File target = new File(System.getProperty("java.io.tmpdir"), "raid-os-test-update.apk");
        assertCode("bad-release", () -> UpdateDownload.download("https://raidos.app/download/android/a.apk", "ABC", 10, target, null));
        assertCode("bad-release", () -> UpdateDownload.download("https://raidos.app/download/android/a.apk", APK_SHA256, 0, target, null));
        assertCode("bad-release", () -> UpdateDownload.download("https://raidos.app/download/android/a.apk", APK_SHA256, UpdateDownload.MAX_APK_BYTES + 1, target, null));
        assertCode("bad-url", () -> UpdateDownload.download("https://example.com/download/android/a.apk", APK_SHA256, APK.length, target, null));
        assertFalse(target.exists());
    }

    @Test
    public void aFileDownloadedBeforeIsKeptWithoutTheNetwork() throws Exception {
        File target = File.createTempFile("raid-os-", ".apk");
        try {
            try (OutputStream out = new FileOutputStream(target)) {
                out.write(APK);
            }
            // The right size and SHA-256 already on disk: returned as is (the address is never opened).
            assertEquals(target, UpdateDownload.download("https://raidos.app/download/android/raid-os.apk", APK_SHA256, APK.length, target, null));
            assertEquals(APK_SHA256, UpdateDownload.fileSha256(target));
        } finally {
            assertTrue(target.delete());
        }
    }

    @Test
    public void theManifestIsReadWithALimit() throws Exception {
        assertEquals("{\"versionCode\":1}", UpdateDownload.readLimited(new ByteArrayInputStream("{\"versionCode\":1}".getBytes(StandardCharsets.UTF_8)), 64));
        assertCode("too-large", () -> UpdateDownload.readLimited(new ByteArrayInputStream(new byte[100]), 64));
        assertTrue(UpdateDownload.isSha256(APK_SHA256));
        assertFalse(UpdateDownload.isSha256(APK_SHA256.toUpperCase()));
    }

    private interface Action {
        void run() throws IOException;
    }

    private static void assertCode(String code, Action action) {
        try {
            action.run();
            fail("expected " + code);
        } catch (UpdateDownload.UpdateException expected) {
            assertEquals(code, expected.code);
        } catch (IOException other) {
            fail("expected " + code + ", got " + other);
        }
    }
}
