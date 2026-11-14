# Lecture 6 - Integration by Parts II

CALC2 · Unit 1 · Integration by Parts

## Repeating the same rule

Keep the same notation: for $y=uv$, write $\frac{dy}{dx}=u\frac{dv}{dx}+v\frac{du}{dx}$. Our integration rule remains

$$\int u\,dv = uv - \int v\,du.$$

LIATE still chooses $u$. A polynomial becomes simpler each time it is differentiated, so a second application may finish what the first starts. Write each application in full; preserve the minus sign outside any parentheses.

## Lecture 6, Example 1

Evaluate $\int x^2e^x\,dx$. LIATE chooses $u=x^2$, $dv=e^x\,dx$, so $du=2x\,dx$ and $v=e^x$.

$$\int x^2e^x\,dx=x^2e^x-2\int xe^x\,dx.$$

For the remaining integral choose $u=x$, $dv=e^x\,dx$ again. Lecture 5 gives $\int xe^x\,dx=xe^x-e^x+C$. Hence

$$\int x^2e^x\,dx=e^x(x^2-2x+2)+C.$$

Check: if $y=e^x(x^2-2x+2)$, then $\frac{dy}{dx}=e^x(x^2-2x+2)+e^x(2x-2)=x^2e^x$.

<!-- pagebreak -->

## Lecture 6, Example 2

Evaluate $\int x\ln x\,dx$ for $x>0$.

LIATE puts the logarithm before the algebraic factor. Choose $u=\ln x$ and $dv=x\,dx$. Then $du=\frac1x\,dx$ and $v=\frac{x^2}{2}$.

$$\int u\,dv = uv - \int v\,du.$$

$$\int x\ln x\,dx=\frac{x^2}{2}\ln x-\frac12\int x\,dx
=\frac{x^2}{2}\ln x-\frac{x^2}{4}+C.$$

The factor $\frac12$ comes from integrating $dv$, not from differentiating the logarithm. For $y=\frac{x^2}{2}\ln x-\frac{x^2}{4}$, the derivative is $\frac{dy}{dx}=x\ln x+\frac{x}{2}-\frac{x}{2}=x\ln x$.

## A sign check

When you replace an integral inside a subtraction, put its entire value in parentheses first. For example, $-2(xe^x-e^x)$ becomes $-2xe^x+2e^x$. Losing those parentheses changes the answer.

On Worksheet 1, problem 3 requires two applications. Stop after each application and ask whether the remaining power has decreased.
