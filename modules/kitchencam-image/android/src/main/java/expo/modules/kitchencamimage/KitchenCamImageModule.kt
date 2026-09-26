package expo.modules.kitchencamimage

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorSpace
import android.graphics.Matrix
import android.graphics.Paint
import android.net.Uri
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.io.FileOutputStream

class RenderRequest : Record {
  @Field var source: String = ""
  @Field var target: String = ""
  @Field var width: Int = 0
  @Field var height: Int = 0
  @Field var outputWidth: Int = 0
  @Field var outputHeight: Int = 0
  @Field var format: String = ""
  @Field var matrix: List<Double> = emptyList()
  @Field var quality: Double = 0.8
}

class KitchenCamImageModule : Module() {
  // Also serializes calls across JS account scopes. No parallel full-size decodes.
  companion object { private val lock = Any() }

  private fun file(uri: String, folder: String): File {
    val parsed = Uri.parse(uri)
    require(parsed.scheme == "file") { "IMAGE_INVALID" }
    val cache = appContext.reactContext?.cacheDir ?: error("IMAGE_UNAVAILABLE")
    val result = File(parsed.path ?: error("IMAGE_INVALID")).canonicalFile
    require(result.parentFile == File(cache, folder).canonicalFile) { "IMAGE_INVALID" }
    return result
  }

  private fun bounds(source: File, width: Int, height: Int, limit: Long) {
    require(source.isFile && source.length() in 1..limit) { "IMAGE_INVALID" }
    val options = BitmapFactory.Options().apply { inJustDecodeBounds = true; inScaled = false }
    BitmapFactory.decodeFile(source.path, options)
    require(width > 0 && height > 0 && width.toLong() * height <= 12_000_000 &&
      options.outWidth == width && options.outHeight == height) { "IMAGE_INVALID" }
  }

  override fun definition() = ModuleDefinition {
    Name("KitchenCamImage")
    AsyncFunction("render") { request: RenderRequest ->
      synchronized(lock) {
        val source = file(request.source, "kitchencam-photos")
        val target = file(request.target, "kitchencam-prepared")
        require(!target.exists() && request.outputWidth in 256..2048 &&
          request.outputHeight in 256..2048 && request.quality in 0.6..0.8 &&
          request.matrix.size == 6 && request.matrix.all { it.isFinite() && it in -1.0..1.0 }) { "IMAGE_INVALID" }
        bounds(source, request.width, request.height, 25L * 1024 * 1024)
        val options = BitmapFactory.Options().apply {
          inScaled = false
          inPreferredConfig = Bitmap.Config.ARGB_8888
          if (Build.VERSION.SDK_INT >= 26) inPreferredColorSpace = ColorSpace.get(ColorSpace.Named.SRGB)
        }
        // BitmapFactory returns raw pixels; it does not apply EXIF orientation.
        val input = BitmapFactory.decodeFile(source.path, options) ?: error("IMAGE_INVALID")
        try {
          require(input.width == request.width && input.height == request.height) { "IMAGE_INVALID" }
          val output = Bitmap.createBitmap(request.outputWidth, request.outputHeight, Bitmap.Config.ARGB_8888)
          try {
            val canvas = Canvas(output)
            canvas.drawColor(Color.WHITE)
            val m = request.matrix
            val w = request.outputWidth.toFloat(); val h = request.outputHeight.toFloat()
            val transform = Matrix().apply {
              setValues(floatArrayOf(
                m[0].toFloat() * w / input.width, m[2].toFloat() * w / input.height, m[4].toFloat() * w,
                m[1].toFloat() * h / input.width, m[3].toFloat() * h / input.height, m[5].toFloat() * h,
                0f, 0f, 1f
              ))
            }
            canvas.drawBitmap(input, transform, Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG))
            FileOutputStream(target).use {
              require(output.compress(Bitmap.CompressFormat.JPEG, (request.quality * 100).toInt(), it)) { "IMAGE_INVALID" }
            }
          } finally { output.recycle() }
        } finally { input.recycle() }
      }
    }
    AsyncFunction("verify") { uri: String, width: Int, height: Int ->
      synchronized(lock) {
        require(width in 256..2048 && height in 256..2048) { "IMAGE_INVALID" }
        val source = file(uri, "kitchencam-prepared")
        bounds(source, width, height, 4L * 1024 * 1024)
        val image = BitmapFactory.decodeFile(source.path) ?: error("IMAGE_INVALID")
        try {
          require(image.width == width && image.height == height) { "IMAGE_INVALID" }
          mapOf("width" to image.width, "height" to image.height)
        } finally { image.recycle() }
      }
    }
  }
}
