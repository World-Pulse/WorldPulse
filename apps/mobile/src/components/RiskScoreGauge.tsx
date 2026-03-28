import { View, Text, StyleSheet } from 'react-native'
import Svg, { Circle, G } from 'react-native-svg'

type Props = {
  score: number  // 0–100
  size?: number
}

function riskColor(score: number): string {
  if (score >= 80) return '#ff3b5c'
  if (score >= 60) return '#f5a623'
  if (score >= 40) return '#00d4ff'
  return '#00e676'
}

function riskLabel(score: number): string {
  if (score >= 80) return 'CRITICAL'
  if (score >= 60) return 'HIGH'
  if (score >= 40) return 'MEDIUM'
  return 'LOW'
}

export function RiskScoreGauge({ score, size = 80 }: Props) {
  const radius    = (size - 12) / 2
  const cx        = size / 2
  const cy        = size / 2
  const circumference = 2 * Math.PI * radius
  // Draw 75% of a circle (270 degrees) as the gauge arc
  const arcLength     = circumference * 0.75
  const fillLength    = arcLength * (Math.max(0, Math.min(100, score)) / 100)
  const gap           = circumference - arcLength
  const dashArray     = `${fillLength} ${circumference - fillLength}`
  const trackDash     = `${arcLength} ${gap}`
  const rotation      = -225  // start from bottom-left

  const color = riskColor(score)
  const label = riskLabel(score)

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <G rotation={rotation} origin={`${cx}, ${cy}`}>
          {/* Track */}
          <Circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke="#141722"
            strokeWidth={8}
            strokeDasharray={trackDash}
            strokeLinecap="round"
          />
          {/* Fill */}
          <Circle
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={8}
            strokeDasharray={dashArray}
            strokeLinecap="round"
          />
        </G>
      </Svg>
      <View style={styles.labelContainer}>
        <Text style={[styles.score, { color }]}>{Math.round(score)}</Text>
        <Text style={[styles.label, { color }]}>{label}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelContainer: {
    position: 'absolute',
    alignItems: 'center',
    gap: 1,
  },
  score: {
    fontSize: 18,
    fontWeight: '800',
    fontFamily: 'monospace',
    lineHeight: 22,
  },
  label: {
    fontSize: 7,
    fontWeight: '700',
    letterSpacing: 1,
    fontFamily: 'monospace',
  },
})
