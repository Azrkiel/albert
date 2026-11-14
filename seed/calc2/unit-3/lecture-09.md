# Lecture 9 - Trigonometric Substitution I

CALC2 · Unit 3 · Trigonometric Substitution

## The five-step recipe

1. Choose the substitution from the table.
2. Find $dx$.
3. Substitute and simplify with a Pythagorean identity.
4. Integrate in $\theta$.
5. Draw the reference triangle and convert back to $x$.

| Root, with $a>0$ | Substitution | Pythagorean identity |
| --- | --- | --- |
| $\sqrt{a^2-x^2}$ | $x=a\sin\theta$ | $1-\sin^2\theta=\cos^2\theta$ |
| $\sqrt{a^2+x^2}$ | $x=a\tan\theta$ | $1+\tan^2\theta=\sec^2\theta$ |
| $\sqrt{x^2-a^2}$ | $x=a\sec\theta$ | $\sec^2\theta-1=\tan^2\theta$ |

The angle is always $\theta$. Derivatives use Leibniz form: $\frac{dx}{d\theta}$, just as we write $\frac{dy}{dx}$. Write Step 2 on its own line before replacing anything in the integral. Substituting for $x$ does not substitute for $dx$ automatically.

For the sine case take $-\frac\pi2<\theta<\frac\pi2$, so $\cos\theta>0$. The examples use $0<x<3$ for a triangle with positive side lengths. On a negative interval use $|x|$ for a side length and recover signs from the chosen angle. Never turn $\sqrt{\cos^2\theta}$ into $\cos\theta$ without an angle restriction.

Always draw the reference triangle to convert back. Read ratios from its sides; do not use inverse-trig identities for that step. If an angle itself remains, name that angle from its defining ratio after drawing the triangle.

<!-- pagebreak -->

## Lecture 9, Example 1

Evaluate $\int\frac{\sqrt{9-x^2}}{x^2}\,dx$ for $0<x<3$.

### Step 1: choose the substitution

The first row of the table gives $x=3\sin\theta$, with $0<\theta<\frac\pi2$.

### Step 2: find dx

$$\frac{dx}{d\theta}=3\cos\theta,\qquad dx=3\cos\theta\,d\theta.$$

### Step 3: substitute and simplify

Use $1-\sin^2\theta=\cos^2\theta$ to obtain $\sqrt{9-x^2}=3\cos\theta$:

$$\int\frac{3\cos\theta}{9\sin^2\theta}\,3\cos\theta\,d\theta
=\int\cot^2\theta\,d\theta=\int(\csc^2\theta-1)\,d\theta.$$

### Step 4: integrate in theta

$$-\cot\theta-\theta+C.$$

### Step 5: draw the reference triangle and convert back

<svg class="triangle" viewBox="0 0 360 132" role="img" aria-label="Reference triangle: opposite x, adjacent square root of 9 minus x squared, hypotenuse 3"><path d="M45 98 L275 98 L275 20 Z M261 98 L261 84 L275 84" fill="none" stroke="currentColor" stroke-width="2"/><text x="110" y="92">θ</text><text x="292" y="65">x</text><text x="150" y="40">3</text><text x="120" y="124">√(9 − x²)</text></svg>

From $\sin\theta=x/3$, the reference triangle gives $\cot\theta=\sqrt{9-x^2}/x$. Its angle is $\theta=\arcsin(x/3)$. Thus

$$-\frac{\sqrt{9-x^2}}{x}-\arcsin(x/3)+C.$$

<!-- pagebreak -->

## Lecture 9, Example 2

Evaluate $\int \frac{dx}{x^2\sqrt{9-x^2}}$ for $0<x<3$.

### Step 1: choose the substitution

Choose $x=3\sin\theta$, with $0<\theta<\frac\pi2$. Keep the factor $x^2$ separate from the root.

### Step 2: find dx

$$\frac{dx}{d\theta}=3\cos\theta,\qquad dx=3\cos\theta\,d\theta.$$

### Step 3: substitute and simplify

The Pythagorean identity gives $\sqrt{9-9\sin^2\theta}=3\cos\theta$. Replace both $x$ and $dx$:

$$\int\frac{3\cos\theta\,d\theta}{9\sin^2\theta\cdot3\cos\theta}
=\frac19\int\csc^2\theta\,d\theta.$$

### Step 4: integrate in theta

$$-\frac19\cot\theta+C.$$

### Step 5: draw the reference triangle and convert back

<svg class="triangle" viewBox="0 0 360 132" role="img" aria-label="Reference triangle: opposite x, adjacent square root of 9 minus x squared, hypotenuse 3"><path d="M45 98 L275 98 L275 20 Z M261 98 L261 84 L275 84" fill="none" stroke="currentColor" stroke-width="2"/><text x="110" y="92">θ</text><text x="292" y="65">x</text><text x="150" y="40">3</text><text x="120" y="124">√(9 − x²)</text></svg>

The reference triangle gives $\cot\theta=\sqrt{9-x^2}/x$, so the answer is

$$-\frac{\sqrt{9-x^2}}{9x}+C.$$

For $y=-\sqrt{9-x^2}/(9x)$, $\frac{dy}{dx}=1/(x^2\sqrt{9-x^2})$. Worksheet 3, problem 1 has the same shape with a different radius.
