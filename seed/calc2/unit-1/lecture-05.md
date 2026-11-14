# Lecture 5 - Integration by Parts I

CALC2 · Unit 1 · Integration by Parts

## From the product rule to an integral

If $y=uv$, the product rule in Leibniz form is $\frac{dy}{dx}=u\frac{dv}{dx}+v\frac{du}{dx}$. Integrate and rearrange to obtain our rule:

$$\int u\,dv = uv - \int v\,du.$$

The minus sign belongs to the whole new integral. Write the rule before putting in the chosen functions. The symbol $dv$ includes the differential; it is not just a function name.

## Choose u with LIATE

LIATE means Logarithmic, Inverse trig, Algebraic, Trigonometric, Exponential. Choose $u$ from the first category present, then put the rest, including $dx$, in $dv$. This is a useful preference, not a guarantee: also check that $du$ is simpler and that you can integrate $dv$.

Our written sequence is: choose $u$ with LIATE; find $du$ and $v$; write the parts rule; evaluate the remaining integral; add $C$. We use repeated written applications when necessary.

<!-- pagebreak -->

## Lecture 5, Example 1

Evaluate $\int x e^x\,dx$.

LIATE puts the algebraic factor before the exponential factor. Choose

$$u=x,\qquad dv=e^x\,dx.$$

Differentiate and integrate the two choices:

$$\frac{du}{dx}=1,\qquad du=dx,\qquad v=e^x.$$

Start from $\int u\,dv = uv - \int v\,du$. Substitution into the rule gives

$$\int x e^x\,dx=xe^x-\int e^x\,dx=xe^x-e^x+C.$$

Check with $y=xe^x-e^x$: $\frac{dy}{dx}=e^x+xe^x-e^x=xe^x$. The extra $e^x$ terms cancel; this is why the subtraction matters.

If you chose $u=e^x$, the algebraic factor would become harder after integration. Use LIATE to avoid that unhelpful trade.

<!-- pagebreak -->

## Lecture 5, Example 2

Evaluate $\int \ln x\,dx$ on $x>0$.

There is an unseen factor of $1$. LIATE chooses the logarithm:

$$u=\ln x,\qquad dv=dx.$$

$$\frac{du}{dx}=\frac1x,\qquad du=\frac1x\,dx,\qquad v=x.$$

Write $\int u\,dv = uv - \int v\,du$, then substitute:

$$\int \ln x\,dx=x\ln x-\int x\frac1x\,dx=x\ln x-x+C.$$

The new integrand is $1$, not $x$. Check with $y=x\ln x-x$: $\frac{dy}{dx}=\ln x+1-1=\ln x$.

## Before you move on

Can you point to the $dx$ inside $dv$? Can you explain why the new integral is simpler? On Worksheet 1, show the LIATE choice and the minus sign even when the algebra looks short.
