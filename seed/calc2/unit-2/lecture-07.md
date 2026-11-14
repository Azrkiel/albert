# Lecture 7 - Trigonometric Integrals I

CALC2 · Unit 2 · Trigonometric Integrals

## Save one factor when a power is odd

The Pythagorean identity is $\sin^2 x+\cos^2 x=1$. If a sine power is odd, save one $\sin x$ and replace the remaining even power by cosines. If a cosine power is odd, save one $\cos x$ and replace the remaining even power by sines.

We use Leibniz notation: for $y=\sin x$, $\frac{dy}{dx}=\cos x$. A change of variable must include its differential. In this unit call the temporary algebraic variable $w$; when an angle is introduced in Unit 3 it will always be $\theta$.

Name the identity before rewriting. The saved factor must still be present when you substitute; it supplies $dw$.

<!-- pagebreak -->

## Lecture 7, Example 1

Evaluate $\int\sin^3 x\,dx$. Save one sine and use the Pythagorean identity:

$$\int\sin^2 x\sin x\,dx=\int(1-\cos^2 x)\sin x\,dx.$$

Set $w=\cos x$. In Leibniz form $\frac{dw}{dx}=-\sin x$, so $dw=-\sin x\,dx$.

$$-\int(1-w^2)\,dw=-w+\frac{w^3}{3}+C
=-\cos x+\frac{\cos^3 x}{3}+C.$$

## Lecture 7, Example 2

Evaluate $\int\sin x\cos^3 x\,dx$. Save $\cos x\,dx$ and replace $\cos^2 x$ by $1-\sin^2 x$. With $w=\sin x$ and $dw=\cos x\,dx$,

$$\int w(1-w^2)\,dw=\frac{w^2}{2}-\frac{w^4}{4}+C
=\frac{\sin^2 x}{2}-\frac{\sin^4 x}{4}+C.$$

Either odd factor can sometimes be saved. Choose the rewrite that leaves a polynomial. Check your sign by differentiating the final expression with $\frac{dy}{dx}$.
