#include <stdio.h>
#include <stdlib.h>

struct Player;
int sum_evens(int *nums, int count);
int count_alive(struct Player *p);
unsigned long factorial(unsigned int n);
int check_password(const char *input);
int apply_op(int op, int a, int b);

int main(int argc, char **argv) {
    int nums[] = {1, 2, 3, 4, 5, 6};
    const char *arg = argc > 1 ? argv[1] : "";
    printf("sum_evens: %d\n", sum_evens(nums, 6));
    printf("count_alive: %d\n", count_alive(NULL));
    printf("factorial: %lu\n", factorial((unsigned)argc + 4));
    printf("check_password: %d\n", check_password(arg));
    printf("apply_op: %d\n", apply_op(argc, 6, 3));
    return 0;
}
