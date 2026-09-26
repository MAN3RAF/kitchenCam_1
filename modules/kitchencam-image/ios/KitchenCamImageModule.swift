import ExpoModulesCore
import UIKit
import ImageIO
import UniformTypeIdentifiers
internal import SDWebImageWebPCoder

struct RenderRequest: Record {
  @Field var source: String = ""
  @Field var target: String = ""
  @Field var width: Int = 0
  @Field var height: Int = 0
  @Field var outputWidth: Int = 0
  @Field var outputHeight: Int = 0
  @Field var format: String = ""
  @Field var matrix: [Double] = []
  @Field var quality: Double = 0.8
}

private struct ImageFailure: Error {}

public class KitchenCamImageModule: Module {
  private static let renderQueue = DispatchQueue(label: "KitchenCamImage.render")

  private func file(_ value: String, folder: String) throws -> URL {
    guard let cache = appContext?.config.cacheDirectory,
      let url = URL(string: value), url.isFileURL,
      url.resolvingSymlinksInPath().deletingLastPathComponent().path ==
        cache.appendingPathComponent(folder, isDirectory: true).resolvingSymlinksInPath().path else { throw ImageFailure() }
    return url
  }
  private func boundedData(_ url: URL, limit: Int) throws -> Data {
    let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
    guard size > 0, size <= limit else { throw ImageFailure() }
    let data = try Data(contentsOf: url, options: .mappedIfSafe)
    guard data.count == size else { throw ImageFailure() }
    return data
  }
  private func rawImage(_ data: Data, format: String, width: Int, height: Int) throws -> CGImage {
    guard width > 0, height > 0, width <= 12_000_000 / height else { throw ImageFailure() }
    let image: CGImage?
    if format == "webp" {
      // Container dimensions were independently parsed before entering native code.
      // Use the raw CGImage, ignoring UIImage orientation. Apply the parsed transform once below.
      image = SDImageWebPCoder.shared.decodedImage(with: data, options: nil)?.cgImage
    } else {
      guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
        CGImageSourceGetCount(source) == 1,
        let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
        props[kCGImagePropertyPixelWidth] as? Int == width,
        props[kCGImagePropertyPixelHeight] as? Int == height else { throw ImageFailure() }
      image = CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary)
    }
    guard let image, image.width == width, image.height == height else { throw ImageFailure() }
    return image
  }

  public func definition() -> ModuleDefinition {
    Name("KitchenCamImage")
    AsyncFunction("render") { (r: RenderRequest) throws in
      try autoreleasepool {
        let source = try self.file(r.source, folder: "kitchencam-photos")
        let target = try self.file(r.target, folder: "kitchencam-prepared")
        guard !FileManager.default.fileExists(atPath: target.path),
          (256...2048).contains(r.outputWidth), (256...2048).contains(r.outputHeight),
          (0.6...0.8).contains(r.quality), r.matrix.count == 6,
          r.matrix.allSatisfy({ $0.isFinite && (-1...1).contains($0) }) else { throw ImageFailure() }
        let data = try self.boundedData(source, limit: 25 * 1024 * 1024)
        let raw = try self.rawImage(data, format: r.format, width: r.width, height: r.height)
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
          let context = CGContext(data: nil, width: r.outputWidth, height: r.outputHeight,
            bitsPerComponent: 8, bytesPerRow: r.outputWidth * 4, space: space,
            bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { throw ImageFailure() }
        let w = CGFloat(r.outputWidth), h = CGFloat(r.outputHeight)
        context.setFillColor(CGColor(gray: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: w, height: h))
        // Enter top-left coordinates, then use the exact shared orientation matrix.
        context.translateBy(x: 0, y: h)
        context.scaleBy(x: 1, y: -1)
        let m = r.matrix.map { CGFloat($0) }
        context.concatenate(CGAffineTransform(a: m[0] * w / CGFloat(raw.width),
          b: m[1] * h / CGFloat(raw.width), c: m[2] * w / CGFloat(raw.height),
          d: m[3] * h / CGFloat(raw.height), tx: m[4] * w, ty: m[5] * h))
        // Raw CGImages draw bottom-up; compensate without applying EXIF a second time.
        context.translateBy(x: 0, y: CGFloat(raw.height))
        context.scaleBy(x: 1, y: -1)
        context.interpolationQuality = .high
        context.draw(raw, in: CGRect(x: 0, y: 0, width: raw.width, height: raw.height))
        guard let pixels = context.makeImage(),
          let destination = CGImageDestinationCreateWithURL(target as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else { throw ImageFailure() }
        CGImageDestinationAddImage(destination, pixels,
          [kCGImageDestinationLossyCompressionQuality: r.quality] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw ImageFailure() }
      }
    }.runOnQueue(Self.renderQueue)
    AsyncFunction("verify") { (uri: String, width: Int, height: Int) throws -> [String: Int] in
      try autoreleasepool {
        guard (256...2048).contains(width), (256...2048).contains(height) else { throw ImageFailure() }
        let url = try self.file(uri, folder: "kitchencam-prepared")
        let data = try self.boundedData(url, limit: 4 * 1024 * 1024)
        let image = try self.rawImage(data, format: "jpeg", width: width, height: height)
        // Force pixel decoding by drawing, not just reading an encoder's dimensions.
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
          let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
            bytesPerRow: width * 4, space: space, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { throw ImageFailure() }
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        return ["width": image.width, "height": image.height]
      }
    }.runOnQueue(Self.renderQueue)
  }
}
