# Lecture 8 - Trigonometric Integrals II

CALC2 · Unit 2 · Trigonometric Integrals

## Both powers even: lower the power

Use the half-angle identities

$$\cos^2 x=\frac12(1+\cos 2x),\qquad
\sin^2 x=\frac12(1-\cos 2x).$$

These formulas trade a square for a constant and a doubled angle. When integrating $\cos 2x$, keep the chain-rule factor: if $y=\sin 2x$, then $\frac{dy}{dx}=2\cos 2x$.

The Pythagorean identities also give $\tan^2\theta=\sec^2\theta-1$ and $\cot^2\theta=\csc^2\theta-1$. We will need them when Unit 3 introduces the angle $\theta$.

For later use, $\int\sec\theta\,d\theta=\ln|\sec\theta+\tan\theta|+C$ and $\int\csc\theta\,d\theta=\ln|\csc\theta-\cot\theta|+C$. Check them with the logarithm rule and Leibniz derivatives before using them.

<!-- pagebreak -->

## Lecture 8, Example 1

Evaluate $\int\cos^2 x\,dx$. Name the half-angle identity, then integrate each term:

$$\int\frac12(1+\cos 2x)\,dx
=\frac{x}{2}+\frac{\sin 2x}{4}+C.$$

If $y=\frac{x}{2}+\frac{\sin 2x}{4}$, then $\frac{dy}{dx}=\frac12+\frac12\cos 2x=\cos^2 x$.

## Lecture 8, Example 2

Evaluate $\int\sin^2 x\cos^2 x\,dx$. First use $\sin 2x=2\sin x\cos x$, then the half-angle identity:

$$\sin^2 x\cos^2 x=\frac14\sin^2 2x
=\frac18(1-\cos 4x).$$

$$\int\sin^2 x\cos^2 x\,dx=\frac{x}{8}-\frac{\sin 4x}{32}+C.$$

## Carry the method into a new variable

The same formulas hold with $\theta$ in place of $x$. For example, $\int\cos^2\theta\,d\theta=\frac{\theta}{2}+\frac{\sin2\theta}{4}+C$. Keep the variable and differential consistent. Worksheet 3 will use this identity inside a root problem.
