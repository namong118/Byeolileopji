/** 자세별 아이콘 (@expo/vector-icons MaterialCommunityIcons — Ionicons 에는 앉은 자세 아이콘이 없다) */
import { MaterialCommunityIcons } from '@expo/vector-icons';

import type { Posture } from '../../utils/posture';

type McIconName = keyof typeof MaterialCommunityIcons.glyphMap;

export const POSTURE_ICON: Record<Posture, McIconName> = {
  standing: 'human-male',
  sitting: 'seat-recline-normal',
  lying: 'bed-outline',
};

export function PostureIcon({
  posture,
  size,
  color,
}: {
  posture: Posture;
  size: number;
  color: string;
}) {
  return <MaterialCommunityIcons name={POSTURE_ICON[posture]} size={size} color={color} />;
}
