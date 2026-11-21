import {
  Text as NativeText,
  type TextProps as NativeTextProps,
  type TextStyle,
} from "react-native";

import { fontFamily } from "@/theme/fonts";
import { type ColorTokens, type TextVariant, textStyles } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

export interface TextProps extends NativeTextProps {
  variant?: TextVariant;
  color?: keyof ColorTokens;
}

/**
 * Texto com a escala do design-system. Acompanha o tamanho de fonte do sistema: nenhum texto
 * limita a escala (Princípio IX).
 */
export function Text({ variant = "body", color = "ink", style, ...props }: TextProps) {
  const { colors } = useTheme();
  const token = textStyles[variant];
  const base: TextStyle = {
    fontFamily: fontFamily(token.role, token.weight),
    fontSize: token.fontSize,
    lineHeight: token.lineHeight,
    color: colors[color],
    fontVariant: "tabular" in token && token.tabular ? ["tabular-nums", "lining-nums"] : undefined,
    letterSpacing: token.role === "heading" ? -0.01 * token.fontSize : undefined,
  };
  return <NativeText {...props} style={[base, style]} />;
}
