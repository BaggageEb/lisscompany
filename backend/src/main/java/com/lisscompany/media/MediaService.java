
package com.lisscompany.media;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import com.cloudinary.Cloudinary;
import com.cloudinary.utils.ObjectUtils;
import com.lisscompany.shared.error.InvalidRequestException;
import com.lisscompany.shared.error.NotFoundException;

@Service
public class MediaService {

    private static final long MAX_BYTES = 5L * 1024 * 1024;
    private static final Pattern NAME =
            Pattern.compile("^[a-f0-9-]{36}\\.(png|jpg|webp)$");

    private final Path dir;
    private final boolean cloudinaryEnabled;
    private final Cloudinary cloudinary;

    public MediaService(
            @Value("${app.media.dir}") String mediaDir,
            @Value("${app.cloudinary.enabled:false}") boolean cloudinaryEnabled,
            ObjectProvider<Cloudinary> cloudinaryProvider) {

        this.dir = Paths.get(mediaDir).toAbsolutePath().normalize();
        this.cloudinaryEnabled = cloudinaryEnabled;
        this.cloudinary = cloudinaryProvider.getIfAvailable();

        if (cloudinaryEnabled && this.cloudinary == null) {
            throw new IllegalStateException(
                    "Cloudinary está ativo, mas não foi configurado.");
        }
    }

    public String store(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new InvalidRequestException(
                    Map.of("file", "Escolha uma imagem."));
        }

        if (file.getSize() > MAX_BYTES) {
            throw new InvalidRequestException(
                    Map.of("file", "A imagem excede 5 MB."));
        }

        try {
            byte[] bytes = file.getBytes();
            String ext = detectExtension(bytes);

            if (ext == null) {
                throw new InvalidRequestException(
                        Map.of("file",
                                "Formato não suportado. Use PNG, JPEG ou WebP."));
            }

            String name = UUID.randomUUID().toString();

            if (cloudinaryEnabled) {
                return uploadToCloudinary(bytes, name);
            }

            Files.createDirectories(dir);
            String localName = name + "." + ext;
            Files.write(dir.resolve(localName), bytes);

            return "/api/v1/public/media/" + localName;

        } catch (IOException ex) {
            throw new UncheckedIOException(ex);
        }
    }

    private String uploadToCloudinary(byte[] bytes, String publicId) throws IOException {
        Map<String, Object> result = cloudinary.uploader().upload(
                bytes,
                ObjectUtils.asMap(
                        "resource_type", "image",
                        "folder", "lisscompany",
                        "public_id", publicId,
                        "overwrite", false
                )
        );

        Object secureUrl = result.get("secure_url");

        if (!(secureUrl instanceof String url)
                || !url.startsWith("https://")) {
            throw new IllegalStateException(
                    "O Cloudinary não devolveu um URL HTTPS válido.");
        }

        return url;
    }

    public byte[] read(String name) {
        if (name == null || !NAME.matcher(name).matches()) {
            throw new NotFoundException(
                    "MEDIA_NOT_FOUND", "Imagem não encontrada.");
        }

        Path file = dir.resolve(name).normalize();

        if (!file.startsWith(dir) || !Files.isRegularFile(file)) {
            throw new NotFoundException(
                    "MEDIA_NOT_FOUND", "Imagem não encontrada.");
        }

        try {
            return Files.readAllBytes(file);
        } catch (IOException ex) {
            throw new UncheckedIOException(ex);
        }
    }

    public static String contentTypeOf(String name) {
        if (name.endsWith(".png")) {
            return "image/png";
        }
        if (name.endsWith(".webp")) {
            return "image/webp";
        }
        return "image/jpeg";
    }

    static String detectExtension(byte[] b) {
        if (b.length >= 8
                && (b[0] & 0xFF) == 0x89
                && b[1] == 'P'
                && b[2] == 'N'
                && b[3] == 'G') {
            return "png";
        }

        if (b.length >= 3
                && (b[0] & 0xFF) == 0xFF
                && (b[1] & 0xFF) == 0xD8
                && (b[2] & 0xFF) == 0xFF) {
            return "jpg";
        }

        if (b.length >= 12
                && b[0] == 'R'
                && b[1] == 'I'
                && b[2] == 'F'
                && b[3] == 'F'
                && b[8] == 'W'
                && b[9] == 'E'
                && b[10] == 'B'
                && b[11] == 'P') {
            return "webp";
        }

        return null;
    }
}
