int sum_evens(int *nums, int count) {
    int total = 0;
    for (int i = 0; i < count; i++) {
        if (nums[i] % 2 == 0)
            total += nums[i];
    }
    return total;
}
