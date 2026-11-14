# CALC2 worksheet answers

Evaluation reference only. This file is excluded from the manifest and is never imported as student content. Each expression below is an antiderivative; add an independent constant $C$ on each connected interval of the integrand's domain. Derivative checks use Leibniz notation $\frac{dy}{dx}$.

## Worksheet 1

### Problem 1

$$xe^x-e^x+C$$

### Problem 2

$$\frac{x^2}{2}\ln x-\frac{x^2}{4}+C$$

Domain: $x>0$.

### Problem 3

$$e^x(x^2-2x+2)+C$$

## Worksheet 2

### Problem 1

$$-\cos x+\frac{\cos^3 x}{3}+C$$

### Problem 2

$$\frac{x}{2}+\frac{\sin(2x)}{4}+C$$

### Problem 3

$$\frac{x}{8}-\frac{\sin(4x)}{32}+C$$

## Worksheet 3

### Problem 1

$$-\frac{\sqrt{16-x^2}}{16x}+C$$

Domain: $-4<x<0$ or $0<x<4$. Use $x=4\sin\theta$; the reference triangle gives $\cot\theta=\sqrt{16-x^2}/x$, with the sign determined by the angle.

### Problem 2

$$\frac{x\sqrt{25-x^2}}{2}+\frac{25}{2}\arcsin(x/5)+C$$

Domain: $-5<x<5$. After $x=5\sin\theta$, the integral is $25\int\cos^2\theta\,d\theta$. Use the half-angle identity. The reference triangle gives $\sin\theta=x/5$ and $\cos\theta=\sqrt{25-x^2}/5$; name the remaining angle from its sine ratio.

### Problem 3

$$\frac{x}{9\sqrt{x^2+9}}+C$$

Domain: all real $x$. With $x=3\tan\theta$, the transformed integral is $\frac19\int\cos\theta\,d\theta$. The reference triangle gives $\sin\theta=x/\sqrt{x^2+9}$.

### Problem 4

$$\frac{1}{6}\ln\left|\frac{x-3}{x+3}\right|+C$$

Domain: $x>3$. The in-scope substitution $x=3\sec\theta$ gives $\frac13\int\csc\theta\,d\theta=\frac13\ln|\csc\theta-\cot\theta|+C$. Draw the reference triangle with adjacent side $3$, hypotenuse $x$, and opposite side $\sqrt{x^2-9}$. Its ratios give $\csc\theta-\cot\theta=(x-3)/\sqrt{x^2-9}$. On this domain, squaring that positive ratio inside the logarithm yields the displayed answer.

### Problem 5

$$\frac{(x^2+4)^{3/2}}{3}-4\sqrt{x^2+4}+C$$

Domain: all real $x$. With $x=2\tan\theta$, the integrand becomes $8\tan^3\theta\sec\theta\,d\theta$. Write $\tan^2\theta=\sec^2\theta-1$ and set $w=\sec\theta$, $dw=\sec\theta\tan\theta\,d\theta$, to get $8(w^3/3-w)+C$. The reference triangle gives $\sec\theta=\sqrt{x^2+4}/2$.

## Worksheet 4

### Problem 1

$$\frac{1}{3}\ln|x-1|-\frac{1}{3}\ln|x+2|+C$$

Domain: each interval avoiding $-2$ and $1$. The rational decomposition has coefficients $1/3$ and $-1/3$.

### Problem 2

$$3\ln|x|-\ln|x+1|+C$$

Domain: each interval avoiding $-1$ and $0$. The decomposition is $3/x-1/(x+1)$.

### Problem 3

$$\ln|x|-\ln|x+1|+\frac{1}{x+1}+C$$

Domain: each interval avoiding $-1$ and $0$. The decomposition is $1/x-1/(x+1)-1/(x+1)^2$.
