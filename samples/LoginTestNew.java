import org.junit.jupiter.api.Test;
import org.openqa.selenium.By;

public class LoginTest {
    private int timeout = 45;

    @Test
    void login() {
        driver.findElement(By.cssSelector(".login-button")).click();
        new WebDriverWait(driver, Duration.ofSeconds(20)).until(ready);
        assertEquals("Home", driver.getTitle());
    }
}
