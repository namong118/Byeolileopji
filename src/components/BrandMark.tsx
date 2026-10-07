import { Image, View } from 'react-native';

interface BrandMarkProps {
  size?: number;
}

/**
 * 원본 이미지에서 심볼(별 + pulse)이 차지하는 비율. adaptive icon foreground 는 런처 마스크
 * 안전 영역 때문에 1024px 중 약 55%만 심볼이고 나머지는 투명 여백이다.
 */
const SYMBOL_FRACTION = 0.55;

/**
 * 별일없지 브랜드 심볼 — 별 외곽선 + 생활신호(pulse) 심볼.
 *
 * 앱 전체 브랜드 이미지를 Android adaptive icon foreground(assets/android-icon-foreground.png,
 * 투명 배경)로 통일한다. 이미지에 안전 영역 여백이 있으므로, `size` 가 **심볼 자체의 크기**가
 * 되도록 이미지를 키워 그리고 바깥 여백은 잘라낸다 (레이아웃 상자는 size × size 그대로).
 * app icon(assets/icon.png)은 rounded-square 배경을 포함하고 있어 인앱에는 쓰지 않는다.
 */
export function BrandMark({ size = 64 }: BrandMarkProps) {
  const imageSize = size / SYMBOL_FRACTION;
  const offset = (size - imageSize) / 2;
  return (
    <View style={{ width: size, height: size, overflow: 'hidden' }}>
      <Image
        source={require('../../assets/android-icon-foreground.png')}
        style={{ width: imageSize, height: imageSize, marginLeft: offset, marginTop: offset }}
        resizeMode="contain"
      />
    </View>
  );
}
