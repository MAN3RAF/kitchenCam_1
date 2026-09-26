Pod::Spec.new do |s|
  s.name           = 'KitchenCamImage'
  s.version        = '0.1.0'
  s.license        = { :type => 'MIT', :file => '../LICENSE' }
  s.summary        = 'KitchenCam local image preparation'
  s.description    = 'Bounded local pixel rendering and JPEG verification.'
  s.author         = 'KitchenCam'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'SDWebImageWebPCoder', '~> 0.14.6'
  s.swift_version = '6.0'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
