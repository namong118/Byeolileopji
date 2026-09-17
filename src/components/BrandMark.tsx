import { Image } from 'react-native';

interface BrandMarkProps {
  size?: number;
}

/**
 * 별일없지 브랜드 심볼 — 별 외곽선 + 생활신호(pulse) 심볼만 담긴 투명 배경
 * asset(assets/brand-symbol.png)을 그대로 표시한다. app icon(assets/icon.png)은
 * White/Warm White rounded-square 배경을 포함하고 있어 인앱에는 별도로 사용하지 않는다.
 * 별도 배경/필터를 코드로 덧씌우지 않는다.
 */
export function BrandMark({ size = 64 }: BrandMarkProps) {
  return (
    <Image
      source={require('../../assets/brand-symbol.png')}
      style={{ width: size, height: size }}
      resizeMode="contain"
    />
  );
}
