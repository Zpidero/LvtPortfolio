# Hidden gallery (the samurai's eye)

Put your photos in this folder and list them in `photos.json`, in the order you want:

```json
{
  "photos": [
    { "src": "tokyo-night.jpg", "caption": "Shinjuku at night — 2025" },
    { "src": "lleida.jpg",      "caption": "Home" }
  ]
}
```

- `src` is the file name inside `assets/gallery/` (or a full URL).
- `caption` is optional.
- JPG/WebP around 1600–2000px on the long side keeps the page fast.
- Delete the `placeholder-*.svg` files once you've added your own.
