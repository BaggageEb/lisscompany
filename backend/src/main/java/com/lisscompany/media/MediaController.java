package com.lisscompany.media;

import java.time.Duration;
import java.util.Map;

import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.lisscompany.shared.error.ForbiddenException;
import com.lisscompany.shared.security.OwnerGuard;
import com.lisscompany.shared.security.Permissions;

@RestController
public class MediaController {

    private final MediaService mediaService;
    private final OwnerGuard ownerGuard;

    public MediaController(MediaService mediaService, OwnerGuard ownerGuard) {
        this.mediaService = mediaService;
        this.ownerGuard = ownerGuard;
    }

    /** Imagens públicas da loja (fotografias). */
    @GetMapping("/api/v1/public/media/{name}")
    public ResponseEntity<byte[]> get(@PathVariable String name) {
        byte[] bytes = mediaService.read(name);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(MediaService.contentTypeOf(name)))
                .cacheControl(CacheControl.maxAge(Duration.ofDays(30)).cachePublic())
                .header("X-Content-Type-Options", "nosniff")
                .body(bytes);
    }

    /** Carregamento de imagem pelo painel (catálogo ou definições). */
    @PostMapping("/api/v1/admin/media")
    public Map<String, String> upload(@RequestParam("file") MultipartFile file) {
        try {
            ownerGuard.current(Permissions.CATALOG_MANAGE);
        } catch (ForbiddenException ex) {
            ownerGuard.current(Permissions.SETTINGS_MANAGE);
        }
        return Map.of("url", mediaService.store(file));
    }
}
