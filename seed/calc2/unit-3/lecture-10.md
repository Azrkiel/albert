# Lecture 10 - Trigonometric Substitution II

CALC2 · Unit 3 · Trigonometric Substitution

## The tan and sec cases

Use the same five-step recipe: choose from the table, find $dx$, substitute with an identity, integrate in $\theta$, then draw the reference triangle and convert back. The angle is always $\theta$.

For $\sqrt{a^2+x^2}$ use $x=a\tan\theta$, $-\frac\pi2<\theta<\frac\pi2$:

$$\frac{dx}{d\theta}=a\sec^2\theta,\qquad dx=a\sec^2\theta\,d\theta.$$

Then $1+\tan^2\theta=\sec^2\theta$ gives $\sqrt{a^2+x^2}=a\sec\theta$. We keep Leibniz derivatives, including $\frac{dy}{dx}$ when checking an answer.

For $\sqrt{x^2-a^2}$ with $x>a$, use $x=a\sec\theta$, $0<\theta<\frac\pi2$:

$$\frac{dx}{d\theta}=a\sec\theta\tan\theta,\qquad
dx=a\sec\theta\tan\theta\,d\theta.$$

Then $\sec^2\theta-1=\tan^2\theta$ gives $\sqrt{x^2-a^2}=a\tan\theta$. Different intervals need explicit signs; the positive-root simplification here uses the first quadrant.

Always draw the reference triangle. Read trig functions from its side ratios, without inverse-trig identities. If the integrated expression contains $\theta$ itself, use the triangle's defining ratio to name that angle.

<!-- pagebreak -->

## Lecture 10, Example 1

Evaluate $\int\frac{dx}{x^2\sqrt{x^2+4}}$ for $x>0$.

### Step 1: choose the substitution

Choose $x=2\tan\theta$, $0<\theta<\frac\pi2$.

### Step 2: find dx

$$\frac{dx}{d\theta}=2\sec^2\theta,\qquad dx=2\sec^2\theta\,d\theta.$$

### Step 3: substitute and simplify

Use $1+\tan^2\theta=\sec^2\theta$ to get $\sqrt{x^2+4}=2\sec\theta$:

$$\int\frac{2\sec^2\theta\,d\theta}{4\tan^2\theta\cdot2\sec\theta}
=\frac14\int\frac{\cos\theta}{\sin^2\theta}\,d\theta.$$

### Step 4: integrate in theta

Since $\frac{d}{d\theta}\csc\theta=-\cos\theta/\sin^2\theta$, the result is $-\frac14\csc\theta+C$.

### Step 5: draw the reference triangle and convert back

<svg class="triangle" viewBox="0 0 360 132" role="img" aria-label="Reference triangle: opposite x, adjacent 2, hypotenuse square root of x squared plus 4"><path d="M45 98 L275 98 L275 20 Z M261 98 L261 84 L275 84" fill="none" stroke="currentColor" stroke-width="2"/><text x="110" y="92">θ</text><text x="292" y="65">x</text><text x="122" y="35">√(x² + 4)</text><text x="155" y="124">2</text></svg>

The reference triangle gives $\csc\theta=\sqrt{x^2+4}/x$. Therefore

$$-\frac{\sqrt{x^2+4}}{4x}+C.$$

<!-- pagebreak -->

## Lecture 10, Example 2

Evaluate $\int\frac{\sqrt{x^2-9}}{x}\,dx$ for $x>3$.

### Step 1: choose the substitution

Choose $x = 3\sec\theta$, with $0<\theta<\frac\pi2$.

### Step 2: find dx

$$\frac{dx}{d\theta}=3\sec\theta\tan\theta,\qquad
dx=3\sec\theta\tan\theta\,d\theta.$$

### Step 3: substitute and simplify

Use $\sec^2\theta-1=\tan^2\theta$ to get $\sqrt{x^2-9}=3\tan\theta$:

$$\int\frac{3\tan\theta}{3\sec\theta}\,3\sec\theta\tan\theta\,d\theta
=3\int\tan^2\theta\,d\theta=3\int(\sec^2\theta-1)\,d\theta.$$

### Step 4: integrate in theta

$$3\tan\theta-3\theta+C.$$

### Step 5: draw the reference triangle and convert back

<svg class="triangle" viewBox="0 0 360 132" role="img" aria-label="Reference triangle: opposite square root of x squared minus 9, adjacent 3, hypotenuse x"><path d="M45 98 L245 98 L245 20 Z M231 98 L231 84 L245 84" fill="none" stroke="currentColor" stroke-width="2"/><text x="110" y="92">θ</text><text x="254" y="65">√(x² − 9)</text><text x="143" y="40">x</text><text x="145" y="124">3</text></svg>

The reference triangle gives $\tan\theta=\sqrt{x^2-9}/3$. Its angle is $\theta=\operatorname{arcsec}(x/3)$, so

$$\sqrt{x^2-9}-3\operatorname{arcsec}(x/3)+C.$$

## A useful variation

For Worksheet 3, problem 4, the same $x=3\sec\theta$ changes the integral to $\frac13\int\csc\theta\,d\theta$. Use Lecture 8's logarithm primitive and the reference triangle to return to $x$.
