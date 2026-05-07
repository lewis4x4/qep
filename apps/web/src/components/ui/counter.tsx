import * as React from "react"
import { Button } from "./button"
import { Card, CardContent, CardHeader, CardTitle } from "./card"

interface CounterProps {
  initialCount?: number
  min?: number
  max?: number
  step?: number
  label?: string
  onChange?: (nextCount: number) => void
}

interface NormalizedCounterConfig {
  initialCount: number
  min: number
  max: number
  step: number
  configError: string | null
}

function normalizeCounterConfig({
  initialCount = 0,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  step = 1,
}: Pick<CounterProps, "initialCount" | "min" | "max" | "step">): NormalizedCounterConfig {
  const safeInitialCount = Number.isFinite(initialCount) ? initialCount : 0
  const safeMin = Number.isFinite(min) ? min : Number.NEGATIVE_INFINITY
  const safeMax = Number.isFinite(max) ? max : Number.POSITIVE_INFINITY
  const safeStep = Number.isFinite(step) && step > 0 ? step : 1

  const [normalizedMin, normalizedMax] = safeMin <= safeMax ? [safeMin, safeMax] : [safeMax, safeMin]
  const clampedInitial = Math.min(normalizedMax, Math.max(normalizedMin, safeInitialCount))

  const errors: string[] = []
  if (!Number.isFinite(initialCount)) {
    errors.push("Initial count was invalid and has been reset to 0.")
  }
  if (!Number.isFinite(step) || step <= 0) {
    errors.push("Step must be a positive number. Using 1.")
  }
  if (min > max) {
    errors.push("Minimum was greater than maximum. Bounds were corrected.")
  }

  return {
    initialCount: clampedInitial,
    min: normalizedMin,
    max: normalizedMax,
    step: safeStep,
    configError: errors.length > 0 ? errors.join(" ") : null,
  }
}

export function Counter({
  initialCount = 0,
  min,
  max,
  step,
  label = "counter",
  onChange,
}: CounterProps) {
  const config = React.useMemo(
    () => normalizeCounterConfig({ initialCount, min, max, step }),
    [initialCount, min, max, step]
  )

  const [count, setCount] = React.useState(config.initialCount)
  const [runtimeError, setRuntimeError] = React.useState<string | null>(null)
  const valueId = React.useId()
  const errorId = React.useId()

  React.useEffect(() => {
    setCount(config.initialCount)
  }, [config.initialCount])

  const setCountSafely = React.useCallback(
    (nextCount: number) => {
      const clamped = Math.min(config.max, Math.max(config.min, nextCount))
      setCount(clamped)

      try {
        onChange?.(clamped)
        setRuntimeError(null)
      } catch {
        setRuntimeError("The counter value updated, but the change handler failed.")
      }
    },
    [config.max, config.min, onChange]
  )

  const decrement = React.useCallback(() => {
    setCountSafely(count - config.step)
  }, [count, config.step, setCountSafely])

  const increment = React.useCallback(() => {
    setCountSafely(count + config.step)
  }, [count, config.step, setCountSafely])

  const isAtMin = Number.isFinite(config.min) && count <= config.min
  const isAtMax = Number.isFinite(config.max) && count >= config.max
  const errorMessage = runtimeError ?? config.configError

  return (
    <Card className="mx-auto w-full max-w-md" role="group" aria-label={`${label} controls`}>
      <CardHeader>
        <CardTitle className="text-center">Counter Component</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <output
          id={valueId}
          className="block text-center text-3xl font-bold"
          aria-live="polite"
          aria-atomic="true"
        >
          {count}
        </output>

        <div className="flex justify-center gap-2">
          <Button
            onClick={decrement}
            variant="outline"
            size="sm"
            disabled={isAtMin}
            aria-label={`Decrease ${label}`}
            aria-controls={valueId}
          >
            -
          </Button>
          <Button
            onClick={increment}
            variant="default"
            size="sm"
            disabled={isAtMax}
            aria-label={`Increase ${label}`}
            aria-controls={valueId}
          >
            +
          </Button>
        </div>

        {errorMessage ? (
          <p id={errorId} role="alert" className="text-sm text-destructive">
            {errorMessage}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}